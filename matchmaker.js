class Matchmaker {
  constructor(io, pool) {
    this.io = io;
    this.pool = pool;
    this.queues = {
      200: [],
      500: [],
      1000: [],
      2000: [],
      5000: []
    };
    this.activeMatches = new Map(); // roomId -> match data
    this.playerRooms = new Map(); // socketId -> roomId
  }

  // Add player to matchmaking queue
  async addToQueue(socket, entryFee) {
    try {
      // Check if player has enough coins
      const [users] = await this.pool.execute(
        'SELECT coins FROM users WHERE user_id = ?',
        [socket.userId]
      );

      if (users.length === 0 || users[0].coins < entryFee) {
        socket.emit('error', 'Insufficient coins');
        return;
      }

      // Remove from any existing queue first
      this.removeFromQueue(socket);

      // Add to appropriate queue
      const queue = this.queues[entryFee];
      const playerData = {
        socket: socket,
        userId: socket.userId,
        username: socket.username,
        profile_logo: socket.userData.profile_logo,
        coins: socket.userData.coins,
        entryFee: entryFee,
        joinedAt: Date.now()
      };

      // Check if there's already someone waiting in this queue
      if (queue.length > 0) {
        // Match found! Remove the waiting player and create match
        const opponent = queue.shift();
        await this.createMatch(playerData, opponent, entryFee);
      } else {
        // Add to queue and wait
        queue.push(playerData);
        socket.emit('queueJoined', { 
          entryFee,
          message: 'Searching for opponent...',
          position: 1
        });

        // Set timeout for queue (5 minutes)
        setTimeout(() => {
          this.removeFromQueue(socket);
          socket.emit('queueTimeout', 'No opponent found. Try again.');
        }, 300000); // 5 minutes
      }

    } catch (error) {
      console.error('Add to queue error:', error);
      socket.emit('error', 'Failed to join queue');
    }
  }

  // Remove player from queue
  removeFromQueue(socket) {
    Object.keys(this.queues).forEach(entryFee => {
      this.queues[entryFee] = this.queues[entryFee].filter(
        player => player.socket.id !== socket.id
      );
    });
  }

  // Create a match between two players
  async createMatch(player1, player2, entryFee) {
    const roomId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const prizePool = entryFee * 2;

    try {
      // Deduct entry fees from both players
      await this.pool.execute(
        'UPDATE users SET coins = coins - ? WHERE user_id = ?',
        [entryFee, player1.userId]
      );

      await this.pool.execute(
        'UPDATE users SET coins = coins - ? WHERE user_id = ?',
        [entryFee, player2.userId]
      );

      // Create match record in database
      const [matchResult] = await this.pool.execute(
        `INSERT INTO matches (room_id, entry_fee, player1_id, player2_id, prize_pool) 
         VALUES (?, ?, ?, ?, ?)`,
        [roomId, entryFee, player1.userId, player2.userId, prizePool]
      );

      // Generate questions for this match
      const questions = this.generateQuestions();

      // Create match data
      const matchData = {
        matchId: matchResult.insertId,
        roomId: roomId,
        player1: {
          userId: player1.userId,
          username: player1.username,
          profile_logo: player1.profile_logo,
          socket: player1.socket,
          score: 0,
          currentQuestion: 0,
          answers: []
        },
        player2: {
          userId: player2.userId,
          username: player2.username,
          profile_logo: player2.profile_logo,
          socket: player2.socket,
          score: 0,
          currentQuestion: 0,
          answers: []
        },
        entryFee: entryFee,
        prizePool: prizePool,
        questions: questions,
        startTime: null,
        endTime: null,
        timer: null,
        status: 'waiting' // waiting, countdown, active, finished
      };

      // Store match data
      this.activeMatches.set(roomId, matchData);
      this.playerRooms.set(player1.socket.id, roomId);
      this.playerRooms.set(player2.socket.id, roomId);

      // Join socket rooms
      player1.socket.join(roomId);
      player2.socket.join(roomId);

      // Notify both players about match found
      const matchFoundData = {
        roomId: roomId,
        opponent: {
          username: player2.username,
          profile_logo: player2.profile_logo
        },
        entryFee: entryFee,
        prizePool: prizePool
      };

      player1.socket.emit('matchFound', {
        ...matchFoundData,
        opponent: {
          username: player2.username,
          profile_logo: player2.profile_logo
        }
      });

      player2.socket.emit('matchFound', {
        ...matchFoundData,
        opponent: {
          username: player1.username,
          profile_logo: player1.profile_logo
        }
      });

      // Start countdown after 3 seconds (for animation)
      setTimeout(() => {
        this.startCountdown(roomId);
      }, 3000);

    } catch (error) {
      console.error('Create match error:', error);
      player1.socket.emit('error', 'Failed to create match');
      player2.socket.emit('error', 'Failed to create match');
    }
  }

  // Start game countdown
  startCountdown(roomId) {
    const match = this.activeMatches.get(roomId);
    if (!match) return;

    match.status = 'countdown';
    let countdown = 5;

    const countdownInterval = setInterval(() => {
      this.io.to(roomId).emit('countdown', countdown);
      countdown--;

      if (countdown < 0) {
        clearInterval(countdownInterval);
        this.startGame(roomId);
      }
    }, 1000);
  }

  // Start the actual game
  startGame(roomId) {
    const match = this.activeMatches.get(roomId);
    if (!match) return;

    match.status = 'active';
    match.startTime = Date.now();
    match.endTime = match.startTime + (2 * 60 * 1000); // 2 minutes

    // Send game start event
    this.io.to(roomId).emit('gameStart', {
      duration: 120, // 2 minutes in seconds
      totalQuestions: match.questions.length
    });

    // Send first question to both players
    match.player1.socket.emit('newQuestion', match.questions[0]);
    match.player2.socket.emit('newQuestion', match.questions[0]);

    // Start game timer
    this.startGameTimer(roomId);
  }

  // Start game timer (2 minutes)
  startGameTimer(roomId) {
    const match = this.activeMatches.get(roomId);
    if (!match) return;

    match.timer = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, match.endTime - now);
      const seconds = Math.ceil(remaining / 1000);

      this.io.to(roomId).emit('timeUpdate', seconds);

      if (remaining <= 0) {
        this.endGame(roomId);
      }
    }, 1000);
  }

  // Handle player answer submission
  async handleAnswer(socket, data) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    const match = this.activeMatches.get(roomId);
    if (!match || match.status !== 'active') return;

    const { questionId, answer } = data;
    const player = match.player1.socket.id === socket.id ? match.player1 : match.player2;
    
    if (player.currentQuestion !== questionId - 1) return; // Wrong question

    const question = match.questions[questionId - 1];
    const isCorrect = answer === question.correct;

    // Update player data
    player.answers.push({
      questionId: questionId,
      answer: answer,
      correct: isCorrect,
      timestamp: Date.now()
    });

    if (isCorrect) {
      player.score += 1;
    }

    player.currentQuestion++;

    // Send score update to both players
    this.io.to(roomId).emit('scoreUpdate', {
      player1: {
        username: match.player1.username,
        score: match.player1.score,
        currentQuestion: match.player1.currentQuestion
      },
      player2: {
        username: match.player2.username,
        score: match.player2.score,
        currentQuestion: match.player2.currentQuestion
      }
    });

    // Send next question if available
    if (player.currentQuestion < match.questions.length) {
      socket.emit('newQuestion', match.questions[player.currentQuestion]);
    } else {
      socket.emit('questionsComplete');
    }

    // Check if both players completed all questions
    if (match.player1.currentQuestion >= match.questions.length && 
        match.player2.currentQuestion >= match.questions.length) {
      this.endGame(roomId);
    }
  }

  // End game and determine winner
  async endGame(roomId) {
    const match = this.activeMatches.get(roomId);
    if (!match || match.status === 'finished') return;

    match.status = 'finished';

    // Clear timer
    if (match.timer) {
      clearInterval(match.timer);
    }

    const player1Score = match.player1.score;
    const player2Score = match.player2.score;

    let winnerId = null;
    let winnerData = null;
    let result = 'draw';

    // Determine winner
    if (player1Score > player2Score) {
      winnerId = match.player1.userId;
      winnerData = match.player1;
      result = 'win';
    } else if (player2Score > player1Score) {
      winnerId = match.player2.userId;
      winnerData = match.player2;
      result = 'win';
    }

    try {
      // Update database
      await this.pool.execute(
        `UPDATE matches SET winner_id = ?, score_p1 = ?, score_p2 = ?, 
         ended_at = CURRENT_TIMESTAMP WHERE match_id = ?`,
        [winnerId, player1Score, player2Score, match.matchId]
      );

      if (result === 'draw') {
        // Refund entry fees for draw
        await this.pool.execute(
          'UPDATE users SET coins = coins + ? WHERE user_id = ? OR user_id = ?',
          [match.entryFee, match.player1.userId, match.player2.userId]
        );
      } else {
        // Give prize to winner and update stats
        await this.pool.execute(
          'UPDATE users SET coins = coins + ?, wins = wins + 1, total_matches = total_matches + 1 WHERE user_id = ?',
          [match.prizePool, winnerId]
        );

        // Update loser stats
        const loserId = winnerId === match.player1.userId ? match.player2.userId : match.player1.userId;
        await this.pool.execute(
          'UPDATE users SET losses = losses + 1, total_matches = total_matches + 1 WHERE user_id = ?',
          [loserId]
        );
      }

      // Send game results to both players
      const gameResult = {
        result: result,
        finalScores: {
          player1: { username: match.player1.username, score: player1Score },
          player2: { username: match.player2.username, score: player2Score }
        },
        winner: winnerData ? {
          username: winnerData.username,
          profile_logo: winnerData.profile_logo
        } : null,
        prizePool: match.prizePool,
        entryFee: match.entryFee
      };

      // Send personalized results
      match.player1.socket.emit('gameOver', {
        ...gameResult,
        yourResult: player1Score > player2Score ? 'won' : (player1Score === player2Score ? 'draw' : 'lost'),
        coinsWon: player1Score > player2Score ? match.prizePool : (player1Score === player2Score ? match.entryFee : 0)
      });

      match.player2.socket.emit('gameOver', {
        ...gameResult,
        yourResult: player2Score > player1Score ? 'won' : (player1Score === player2Score ? 'draw' : 'lost'),
        coinsWon: player2Score > player1Score ? match.prizePool : (player1Score === player2Score ? match.entryFee : 0)
      });

    } catch (error) {
      console.error('End game error:', error);
    }

    // Cleanup
    setTimeout(() => {
      this.cleanupMatch(roomId);
    }, 30000); // Keep match data for 30 seconds for result viewing
  }

  // Handle player disconnect
  handleDisconnect(socket) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    const match = this.activeMatches.get(roomId);
    if (!match) return;

    if (match.status === 'active') {
      // Forfeit the game for disconnected player
      const disconnectedPlayer = match.player1.socket.id === socket.id ? match.player1 : match.player2;
      const remainingPlayer = disconnectedPlayer === match.player1 ? match.player2 : match.player1;

      // End game with remaining player as winner
      this.forfeitGame(roomId, remainingPlayer.userId);
    } else {
      // Just cleanup if game hasn't started
      this.cleanupMatch(roomId);
    }
  }

  // Handle game forfeit
  async forfeitGame(roomId, winnerId) {
    const match = this.activeMatches.get(roomId);
    if (!match) return;

    match.status = 'finished';

    if (match.timer) {
      clearInterval(match.timer);
    }

    try {
      // Update database
      await this.pool.execute(
        `UPDATE matches SET winner_id = ?, score_p1 = ?, score_p2 = ?, 
         ended_at = CURRENT_TIMESTAMP WHERE match_id = ?`,
        [winnerId, match.player1.score, match.player2.score, match.matchId]
      );

      // Give prize to winner
      await this.pool.execute(
        'UPDATE users SET coins = coins + ?, wins = wins + 1, total_matches = total_matches + 1 WHERE user_id = ?',
        [match.prizePool, winnerId]
      );

      // Update loser stats
      const loserId = winnerId === match.player1.userId ? match.player2.userId : match.player1.userId;
      await this.pool.execute(
        'UPDATE users SET losses = losses + 1, total_matches = total_matches + 1 WHERE user_id = ?',
        [loserId]
      );

      // Notify remaining player
      const winner = winnerId === match.player1.userId ? match.player1 : match.player2;
      winner.socket.emit('gameOver', {
        result: 'win',
        finalScores: {
          player1: { username: match.player1.username, score: match.player1.score },
          player2: { username: match.player2.username, score: match.player2.score }
        },
        winner: {
          username: winner.username,
          profile_logo: winner.profile_logo
        },
        prizePool: match.prizePool,
        entryFee: match.entryFee,
        yourResult: 'won',
        coinsWon: match.prizePool,
        reason: 'Opponent disconnected'
      });

    } catch (error) {
      console.error('Forfeit game error:', error);
    }

    this.cleanupMatch(roomId);
  }

  // Generate math questions
  generateQuestions() {
    const questions = [];
    for (let i = 0; i < 20; i++) {
      const num1 = Math.floor(Math.random() * 50) + 1;
      const num2 = Math.floor(Math.random() * 50) + 1;
      const correct = num1 + num2;
      const options = [correct];
      
      // Generate 3 wrong options
      while (options.length < 4) {
        const wrong = correct + Math.floor(Math.random() * 20) - 10;
        if (wrong > 0 && !options.includes(wrong)) {
          options.push(wrong);
        }
      }
      
      // Shuffle options
      options.sort(() => Math.random() - 0.5);
      
      questions.push({
        id: i + 1,
        question: `${num1} + ${num2} = ?`,
        options: options,
        correct: correct
      });
    }
    return questions;
  }

  // Cleanup match data
  cleanupMatch(roomId) {
    const match = this.activeMatches.get(roomId);
    if (!match) return;

    // Remove player room mappings
    this.playerRooms.delete(match.player1.socket.id);
    this.playerRooms.delete(match.player2.socket.id);

    // Remove match data
    this.activeMatches.delete(roomId);

    console.log(`Match ${roomId} cleaned up`);
  }

  // Get queue status
  getQueueStatus() {
    const status = {};
    Object.keys(this.queues).forEach(entryFee => {
      status[entryFee] = this.queues[entryFee].length;
    });
    return status;
  }

  // Get active matches count
  getActiveMatchesCount() {
    return this.activeMatches.size;
  }
}

module.exports = Matchmaker;
