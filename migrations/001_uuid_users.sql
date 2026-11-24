-- One-time, data-preserving conversion for the existing Railopt schema.
-- Back up database `railopt` before running. Run with a MySQL account that has
-- CREATE, ALTER, INDEX, and REFERENCES privileges on this schema.
-- This migration must not be run twice.

USE railopt;

CREATE TABLE users (
    id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    username VARCHAR(80) NOT NULL UNIQUE,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role TINYINT UNSIGNED NOT NULL DEFAULT 2 COMMENT '1=administrator, 2=standard user',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_users_role CHECK (role IN (1, 2))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add new identifiers alongside existing numeric IDs so references can be mapped.
ALTER TABLE routes ADD COLUMN id_uuid CHAR(36) NULL;
ALTER TABLE shipments ADD COLUMN id_uuid CHAR(36) NULL, ADD COLUMN route_uuid CHAR(36) NULL;
ALTER TABLE holidays ADD COLUMN id_uuid CHAR(36) NULL;
ALTER TABLE parameters ADD COLUMN id_uuid CHAR(36) NULL;
ALTER TABLE terminals ADD COLUMN id_uuid CHAR(36) NULL;
ALTER TABLE rail_operators ADD COLUMN id_uuid CHAR(36) NULL;
ALTER TABLE rail_connections
    ADD COLUMN id_uuid CHAR(36) NULL,
    ADD COLUMN departure_terminal_uuid CHAR(36) NULL,
    ADD COLUMN arrival_terminal_uuid CHAR(36) NULL,
    ADD COLUMN operator_uuid CHAR(36) NULL;
ALTER TABLE terminal_legs
    ADD COLUMN id_uuid CHAR(36) NULL,
    ADD COLUMN route_uuid CHAR(36) NULL,
    ADD COLUMN terminal_uuid CHAR(36) NULL;
ALTER TABLE transport_results ADD COLUMN id_uuid CHAR(36) NULL, ADD COLUMN shipment_uuid CHAR(36) NULL;

UPDATE routes SET id_uuid=UUID();
UPDATE shipments SET id_uuid=UUID();
UPDATE holidays SET id_uuid=UUID();
UPDATE parameters SET id_uuid=UUID();
UPDATE terminals SET id_uuid=UUID();
UPDATE rail_operators SET id_uuid=UUID();
UPDATE rail_connections SET id_uuid=UUID();
UPDATE terminal_legs SET id_uuid=UUID();
UPDATE transport_results SET id_uuid=UUID();

UPDATE shipments s JOIN routes r ON r.id=s.route_id SET s.route_uuid=r.id_uuid;
UPDATE rail_connections rc JOIN terminals t ON t.id=rc.departure_terminal_id SET rc.departure_terminal_uuid=t.id_uuid;
UPDATE rail_connections rc JOIN terminals t ON t.id=rc.arrival_terminal_id SET rc.arrival_terminal_uuid=t.id_uuid;
UPDATE rail_connections rc JOIN rail_operators o ON o.id=rc.operator_id SET rc.operator_uuid=o.id_uuid;
UPDATE terminal_legs l JOIN routes r ON r.id=l.route_id SET l.route_uuid=r.id_uuid;
UPDATE terminal_legs l JOIN terminals t ON t.id=l.terminal_id SET l.terminal_uuid=t.id_uuid;
UPDATE transport_results tr JOIN shipments s ON s.id=tr.shipment_id SET tr.shipment_uuid=s.id_uuid;

ALTER TABLE routes MODIFY id_uuid CHAR(36) NOT NULL;
ALTER TABLE shipments MODIFY id_uuid CHAR(36) NOT NULL, MODIFY route_uuid CHAR(36) NOT NULL;
ALTER TABLE holidays MODIFY id_uuid CHAR(36) NOT NULL;
ALTER TABLE parameters MODIFY id_uuid CHAR(36) NOT NULL;
ALTER TABLE terminals MODIFY id_uuid CHAR(36) NOT NULL;
ALTER TABLE rail_operators MODIFY id_uuid CHAR(36) NOT NULL;
ALTER TABLE rail_connections
    MODIFY id_uuid CHAR(36) NOT NULL,
    MODIFY departure_terminal_uuid CHAR(36) NOT NULL,
    MODIFY arrival_terminal_uuid CHAR(36) NOT NULL,
    MODIFY operator_uuid CHAR(36) NOT NULL;
ALTER TABLE terminal_legs
    MODIFY id_uuid CHAR(36) NOT NULL,
    MODIFY route_uuid CHAR(36) NOT NULL,
    MODIFY terminal_uuid CHAR(36) NOT NULL;
ALTER TABLE transport_results MODIFY id_uuid CHAR(36) NOT NULL, MODIFY shipment_uuid CHAR(36) NOT NULL;

-- Drop old relationships before swapping key types.
ALTER TABLE shipments DROP FOREIGN KEY fk_shipments_route;
ALTER TABLE rail_connections
    DROP FOREIGN KEY rail_connections_ibfk_1,
    DROP FOREIGN KEY rail_connections_ibfk_2,
    DROP FOREIGN KEY rail_connections_ibfk_3;
ALTER TABLE terminal_legs
    DROP FOREIGN KEY terminal_legs_ibfk_1,
    DROP FOREIGN KEY terminal_legs_ibfk_2;
ALTER TABLE transport_results DROP FOREIGN KEY transport_results_ibfk_1;

-- Replace primary keys, keeping all business columns and rows intact.
ALTER TABLE routes DROP PRIMARY KEY, DROP COLUMN id, CHANGE COLUMN id_uuid id CHAR(36) NOT NULL DEFAULT (UUID()), ADD PRIMARY KEY (id);
ALTER TABLE shipments DROP PRIMARY KEY, DROP COLUMN id, CHANGE COLUMN id_uuid id CHAR(36) NOT NULL DEFAULT (UUID()), ADD PRIMARY KEY (id);
ALTER TABLE holidays DROP PRIMARY KEY, DROP COLUMN id, CHANGE COLUMN id_uuid id CHAR(36) NOT NULL DEFAULT (UUID()), ADD PRIMARY KEY (id);
ALTER TABLE parameters DROP PRIMARY KEY, DROP COLUMN id, CHANGE COLUMN id_uuid id CHAR(36) NOT NULL DEFAULT (UUID()), ADD PRIMARY KEY (id);
ALTER TABLE terminals DROP PRIMARY KEY, DROP COLUMN id, CHANGE COLUMN id_uuid id CHAR(36) NOT NULL DEFAULT (UUID()), ADD PRIMARY KEY (id);
ALTER TABLE rail_operators DROP PRIMARY KEY, DROP COLUMN id, CHANGE COLUMN id_uuid id CHAR(36) NOT NULL DEFAULT (UUID()), ADD PRIMARY KEY (id);
ALTER TABLE rail_connections DROP PRIMARY KEY, DROP COLUMN id, CHANGE COLUMN id_uuid id CHAR(36) NOT NULL DEFAULT (UUID()), ADD PRIMARY KEY (id);
ALTER TABLE terminal_legs DROP PRIMARY KEY, DROP COLUMN id, CHANGE COLUMN id_uuid id CHAR(36) NOT NULL DEFAULT (UUID()), ADD PRIMARY KEY (id);
ALTER TABLE transport_results DROP PRIMARY KEY, DROP COLUMN id, CHANGE COLUMN id_uuid id CHAR(36) NOT NULL DEFAULT (UUID()), ADD PRIMARY KEY (id);

-- Replace foreign-key values with their mapped UUIDs and restore indexes/constraints.
ALTER TABLE shipments DROP INDEX idx_shipment_route, CHANGE COLUMN route_id route_id_legacy BIGINT NOT NULL, CHANGE COLUMN route_uuid route_id CHAR(36) NOT NULL;
ALTER TABLE shipments DROP COLUMN route_id_legacy, ADD INDEX idx_shipment_route (route_id), ADD CONSTRAINT fk_shipments_route FOREIGN KEY (route_id) REFERENCES routes(id);

ALTER TABLE rail_connections
    DROP INDEX departure_terminal_id,
    DROP INDEX arrival_terminal_id,
    DROP INDEX operator_id,
    CHANGE COLUMN departure_terminal_id departure_terminal_id_legacy BIGINT NOT NULL,
    CHANGE COLUMN arrival_terminal_id arrival_terminal_id_legacy BIGINT NOT NULL,
    CHANGE COLUMN operator_id operator_id_legacy BIGINT NOT NULL,
    CHANGE COLUMN departure_terminal_uuid departure_terminal_id CHAR(36) NOT NULL,
    CHANGE COLUMN arrival_terminal_uuid arrival_terminal_id CHAR(36) NOT NULL,
    CHANGE COLUMN operator_uuid operator_id CHAR(36) NOT NULL;
ALTER TABLE rail_connections
    DROP COLUMN departure_terminal_id_legacy,
    DROP COLUMN arrival_terminal_id_legacy,
    DROP COLUMN operator_id_legacy,
    ADD INDEX (departure_terminal_id), ADD INDEX (arrival_terminal_id), ADD INDEX (operator_id),
    ADD CONSTRAINT rail_connections_ibfk_1 FOREIGN KEY (departure_terminal_id) REFERENCES terminals(id),
    ADD CONSTRAINT rail_connections_ibfk_2 FOREIGN KEY (arrival_terminal_id) REFERENCES terminals(id),
    ADD CONSTRAINT rail_connections_ibfk_3 FOREIGN KEY (operator_id) REFERENCES rail_operators(id);

ALTER TABLE terminal_legs
    DROP INDEX route_id, DROP INDEX terminal_id,
    CHANGE COLUMN route_id route_id_legacy BIGINT NOT NULL,
    CHANGE COLUMN terminal_id terminal_id_legacy BIGINT NOT NULL,
    CHANGE COLUMN route_uuid route_id CHAR(36) NOT NULL,
    CHANGE COLUMN terminal_uuid terminal_id CHAR(36) NOT NULL;
ALTER TABLE terminal_legs
    DROP COLUMN route_id_legacy, DROP COLUMN terminal_id_legacy,
    ADD INDEX (route_id), ADD INDEX (terminal_id),
    ADD CONSTRAINT terminal_legs_ibfk_1 FOREIGN KEY (route_id) REFERENCES routes(id),
    ADD CONSTRAINT terminal_legs_ibfk_2 FOREIGN KEY (terminal_id) REFERENCES terminals(id);

ALTER TABLE transport_results DROP INDEX idx_result_shipment, CHANGE COLUMN shipment_id shipment_id_legacy BIGINT NOT NULL, CHANGE COLUMN shipment_uuid shipment_id CHAR(36) NOT NULL;
ALTER TABLE transport_results DROP COLUMN shipment_id_legacy, ADD INDEX idx_result_shipment (shipment_id), ADD CONSTRAINT transport_results_ibfk_1 FOREIGN KEY (shipment_id) REFERENCES shipments(id);
