-- Ajouter le champ possessed_number directement sur card
ALTER TABLE card ADD COLUMN possessed_number int DEFAULT 0;

-- Migrer les données existantes : additionner les nombres par carte
UPDATE card c
SET possessed_number = COALESCE((
    SELECT SUM(cp.number)
    FROM card_possessed cp
    JOIN card_set cs ON cp.card_set_id = cs.id
    WHERE cs.card_id = c.id
), 0);

-- Supprimer la table card_possessed
DROP TABLE card_possessed;
