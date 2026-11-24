
CREATE DATABASE IF NOT EXISTS railopt
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE railopt;

-- =========================================
-- 1. TRANSPORTNE RELACIJE
-- =========================================

CREATE TABLE routes (
    id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    route_code VARCHAR(3) NOT NULL UNIQUE,

    direction ENUM('Izvoz', 'Uvoz') NOT NULL,

    loading_country CHAR(2) NOT NULL,
    loading_postal_code VARCHAR(15) NOT NULL,
    loading_city VARCHAR(100) NOT NULL,

    unloading_country CHAR(2) NOT NULL,
    unloading_postal_code VARCHAR(15) NOT NULL,
    unloading_city VARCHAR(100) NOT NULL,

    road_distance_km INT NOT NULL,

    typical_unit_type VARCHAR(100) NOT NULL,

    average_trucks_per_week DECIMAL(5,2),
    shipments_count INT,

    loading_window_start TIME NOT NULL,
    loading_window_end TIME NOT NULL,

    unloading_window_start TIME NOT NULL,
    unloading_window_end TIME NOT NULL,

    cargo_group VARCHAR(150),
    note TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- =========================================
-- 2. POŠILJKE
-- =========================================

CREATE TABLE shipments (
    id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,

    shipment_number INT NOT NULL UNIQUE,

    route_id CHAR(36) NOT NULL,

    loading_text VARCHAR(200),
    unloading_text VARCHAR(200),

    loading_date DATE NOT NULL,
    road_delivery_date DATE NOT NULL,
    recipient_deadline DATE NOT NULL,

    weight_kg DECIMAL(10,2) NOT NULL,

    unit_type VARCHAR(100) NOT NULL,

    adr BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_shipments_route
        FOREIGN KEY (route_id)
        REFERENCES routes(id),

    INDEX idx_shipment_loading_date (loading_date),
    INDEX idx_shipment_delivery_date (road_delivery_date),
    INDEX idx_shipment_route (route_id)
);


-- =========================================
-- 3. PRAZNIKI
-- =========================================

CREATE TABLE holidays (
    id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,

    country_code CHAR(2) NOT NULL,

    holiday_date DATE NOT NULL,

    holiday_name VARCHAR(200) NOT NULL,

    note TEXT,

    UNIQUE KEY unique_country_holiday (
        country_code,
        holiday_date,
        holiday_name
    ),

    INDEX idx_holiday_lookup (
        country_code,
        holiday_date
    )
);


-- =========================================
-- 4. TRANSPORTNI PARAMETRI
-- =========================================

CREATE TABLE parameters (
    id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,

    parameter_code VARCHAR(100) NOT NULL UNIQUE,

    parameter_group VARCHAR(100) NOT NULL,

    parameter_name VARCHAR(200) NOT NULL,

    fixed_value DECIMAL(12,4),
    per_unit_value DECIMAL(12,4),

    numeric_value DECIMAL(12,4),

    unit VARCHAR(50),

    text_value TEXT,

    source_note TEXT
);


-- =========================================
-- 5. ŽELEZNIŠKI TERMINALI
-- =========================================

CREATE TABLE terminals (
    id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,

    name VARCHAR(150) NOT NULL,

    country_code CHAR(2) NOT NULL,

    city VARCHAR(100) NOT NULL,

    address VARCHAR(255),

    latitude DECIMAL(10,7),
    longitude DECIMAL(10,7),

    website VARCHAR(500),

    note TEXT
);


-- =========================================
-- 6. ŽELEZNIŠKI OPERATERJI
-- =========================================

CREATE TABLE rail_operators (
    id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,

    name VARCHAR(150) NOT NULL,

    website VARCHAR(500),

    note TEXT
);


-- =========================================
-- 7. ŽELEZNIŠKE POVEZAVE
-- =========================================

CREATE TABLE rail_connections (
    id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,

    departure_terminal_id CHAR(36) NOT NULL,
    arrival_terminal_id CHAR(36) NOT NULL,

    operator_id CHAR(36) NOT NULL,

    distance_km DECIMAL(10,2),

    departure_day VARCHAR(20),
    departure_time TIME,

    arrival_day VARCHAR(20),
    arrival_time TIME,

    last_acceptance_time TIME,

    pickup_available_time TIME,

    transport_type ENUM('INTERMODAL', 'RO_LA') NOT NULL,

    supported_unit_types TEXT,

    adr_supported BOOLEAN DEFAULT FALSE,

    source_url VARCHAR(1000),

    active BOOLEAN DEFAULT TRUE,

    note TEXT,

    FOREIGN KEY (departure_terminal_id)
        REFERENCES terminals(id),

    FOREIGN KEY (arrival_terminal_id)
        REFERENCES terminals(id),

    FOREIGN KEY (operator_id)
        REFERENCES rail_operators(id)
);


-- =========================================
-- 8. CESTNI DOVOZ IN ODVOZ DO TERMINALOV
-- =========================================

CREATE TABLE terminal_legs (
    id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,

    route_id CHAR(36) NOT NULL,

    terminal_id CHAR(36) NOT NULL,

    leg_type ENUM('PICKUP', 'DELIVERY') NOT NULL,

    distance_km DECIMAL(10,2) NOT NULL,

    travel_time_minutes INT,

    FOREIGN KEY (route_id)
        REFERENCES routes(id),

    FOREIGN KEY (terminal_id)
        REFERENCES terminals(id)
);


-- =========================================
-- 9. REZULTATI OPTIMIZACIJE
-- =========================================

CREATE TABLE transport_results (
    id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,

    shipment_id CHAR(36) NOT NULL,

    transport_type ENUM(
        'ROAD',
        'INTERMODAL',
        'RO_LA'
    ) NOT NULL,

    feasible BOOLEAN NOT NULL DEFAULT FALSE,

    total_cost DECIMAL(12,2),

    delivery_date DATE,

    delivery_time TIME,

    co2_kg DECIMAL(12,4),

    road_distance_km DECIMAL(10,2),

    rail_distance_km DECIMAL(10,2),

    recommended BOOLEAN DEFAULT FALSE,

    rejection_reason TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (shipment_id)
        REFERENCES shipments(id),

    INDEX idx_result_shipment (shipment_id)
);

-- User passwords are bcrypt hashes. Role IDs: 1 = administrator, 2 = standard user.
CREATE TABLE users (
    id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    username VARCHAR(80) NOT NULL UNIQUE,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role TINYINT UNSIGNED NOT NULL DEFAULT 2,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_users_role CHECK (role IN (1, 2))
);