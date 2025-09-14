-- Users Table
CREATE TABLE IF NOT EXISTS users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  phone_number VARCHAR(15) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  username VARCHAR(50) NOT NULL,
  profile_logo TEXT,
  coins INT DEFAULT 1000,
  total_matches INT DEFAULT 0,
  wins INT DEFAULT 0,
  losses INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_phone (phone_number),
  INDEX idx_username (username)
);

-- Matches Table
CREATE TABLE IF NOT EXISTS matches (
  match_id INT AUTO_INCREMENT PRIMARY KEY,
  room_id VARCHAR(100) UNIQUE NOT NULL,
  entry_fee INT NOT NULL,
  prize_pool INT NOT NULL,
  player1_id INT NOT NULL,
  player2_id INT NOT NULL,
  winner_id INT NULL,
  score_p1 INT DEFAULT 0,
  score_p2 INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL,
  ended_at TIMESTAMP NULL,
  
  FOREIGN KEY (player1_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (player2_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (winner_id) REFERENCES users(user_id) ON DELETE SET NULL,
  
  INDEX idx_room (room_id),
  INDEX idx_player1 (player1_id),
  INDEX idx_player2 (player2_id),
  INDEX idx_winner (winner_id),
  INDEX idx_created (created_at)
);

-- Game Sessions Table
CREATE TABLE IF NOT EXISTS game_sessions (
  session_id INT AUTO_INCREMENT PRIMARY KEY,
  match_id INT NOT NULL,
  user_id INT NOT NULL,
  questions_answered INT DEFAULT 0,
  correct_answers INT DEFAULT 0,
  time_taken INT DEFAULT 0,
  disconnected BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  
  INDEX idx_match (match_id),
  INDEX idx_user (user_id)
);

-- Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  match_id INT NULL,
  type ENUM('entry_fee', 'prize_win', 'refund', 'bonus') NOT NULL,
  amount INT NOT NULL,
  balance_before INT NOT NULL,
  balance_after INT NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE SET NULL,
  
  INDEX idx_user (user_id),
  INDEX idx_match (match_id),
  INDEX idx_type (type),
  INDEX idx_created (created_at)
);
