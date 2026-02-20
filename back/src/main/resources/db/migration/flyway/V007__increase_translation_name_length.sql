-- Augmenter la longueur de la colonne name dans translation (de 64 à 255 caractères)
ALTER TABLE translation ALTER COLUMN name TYPE varchar(255);
