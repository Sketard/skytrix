-- Reset local flags for alternate art images so they get re-fetched with the correct imageId-based URL.
-- Previously, fetchImage used card.passcode instead of cardImage.imageId, causing all artworks
-- of the same card to download the same file.
UPDATE card_image
SET small_local = false, local = false
WHERE image_id != (SELECT c.passcode FROM card c WHERE c.id = card_image.card_id);
