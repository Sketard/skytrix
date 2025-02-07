TRUNCATE TABLE card CASCADE;

ALTER TABLE card DROP type;
ALTER TABLE card ADD type varchar[];