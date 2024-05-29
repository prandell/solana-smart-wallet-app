DROP TABLE IF EXISTS Users;

DROP TABLE IF EXISTS Wallets;

CREATE TABLE
    IF NOT EXISTS Users (
        user_id INTEGER PRIMARY KEY,
        user_email TEXT NOT NULL UNIQUE,
        sub_org_id TEXT NOT NULL UNIQUE
    );

CREATE TABLE
    IF NOT EXISTS Wallets (
        wallet_id TEXT PRIMARY KEY,
        eth_address TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        sol_address TEXT,
        wren_address TEXT,
        FOREIGN KEY (user_id) REFERENCES users (user_id)
    );