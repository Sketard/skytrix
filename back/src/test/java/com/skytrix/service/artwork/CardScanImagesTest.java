package com.skytrix.service.artwork;

import org.junit.jupiter.api.Test;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.util.Random;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CardScanImagesTest {

    /**
     * A card-shaped picture: flat frame colour and an illustration of random blobs drawn from {@code seed} at a
     * reference size, then scaled to {@code width × height} and darkened by {@code brightness} — the same artwork
     * whatever the size, as a render and a scan of one card are.
     */
    static BufferedImage card(long seed, int width, int height, float brightness, boolean transparentCorners) {
        int refW = 822;
        int refH = 1198;
        var reference = new BufferedImage(refW, refH, BufferedImage.TYPE_INT_RGB);
        var g = reference.createGraphics();
        g.setColor(new Color(0xB0, 0x60, 0x30));
        g.fillRect(0, 0, refW, refH);
        var random = new Random(seed);
        int x0 = (int) (refW * 0.12);
        int y0 = (int) (refH * 0.185);
        int bw = (int) (refW * 0.76);
        int bh = (int) (refH * 0.515);
        for (int i = 0; i < 40; i++) {
            g.setColor(new Color(random.nextInt(256), random.nextInt(256), random.nextInt(256)));
            int w = bw / 4 + random.nextInt(bw / 3);
            int h = bh / 4 + random.nextInt(bh / 3);
            g.fillOval(x0 + random.nextInt(bw - w), y0 + random.nextInt(bh - h), w, h);
        }
        g.dispose();

        var image = new BufferedImage(width, height, transparentCorners ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        var out = image.createGraphics();
        if (transparentCorners) {
            out.setClip(new java.awt.geom.RoundRectangle2D.Float(0, 0, width, height, width / 10f, width / 10f));
        }
        out.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        out.drawImage(reference, 0, 0, width, height, null);
        out.dispose();
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int argb = image.getRGB(x, y);
                int r = (int) (((argb >> 16) & 0xff) * brightness);
                int gr = (int) (((argb >> 8) & 0xff) * brightness);
                int b = (int) ((argb & 0xff) * brightness);
                image.setRGB(x, y, (argb & 0xff000000) | (r << 16) | (gr << 8) | b);
            }
        }
        return image;
    }

    @Test
    void sameArtworkAtAnotherSizeAndBrightnessStaysUnderTheThreshold() {
        var render = CardScanImages.artworkHash(card(1, 268, 391, 1f, false));
        var scan = CardScanImages.artworkHash(card(1, 822, 1198, 0.8f, true));
        assertTrue(CardScanImages.distance(render, scan) <= CardScanImages.SAME_ARTWORK_MAX_DISTANCE,
                "distance " + CardScanImages.distance(render, scan));
    }

    @Test
    void differentArtworksAreFarApart() {
        var a = CardScanImages.artworkHash(card(1, 268, 391, 1f, false));
        var b = CardScanImages.artworkHash(card(2, 268, 391, 1f, false));
        assertTrue(CardScanImages.distance(a, b) > CardScanImages.SAME_ARTWORK_MAX_DISTANCE,
                "distance " + CardScanImages.distance(a, b));
    }

    @Test
    void scanBecomesAnOpaquePictureOfTheRenderSize() {
        var out = CardScanImages.toCardImage(card(3, 822, 1198, 0.8f, true), CardScanImages.BIG_WIDTH, CardScanImages.BIG_HEIGHT);
        assertEquals(CardScanImages.BIG_WIDTH, out.getWidth());
        assertEquals(CardScanImages.BIG_HEIGHT, out.getHeight());
        assertEquals(BufferedImage.TYPE_INT_RGB, out.getType());
        var jpeg = CardScanImages.jpeg(out, 0.9f);
        assertEquals(CardScanImages.BIG_WIDTH, CardScanImages.read(jpeg).getWidth());
    }

    @Test
    void autoLevelsStretchesADullPictureButNotPastTheGainCap() {
        var dull = new BufferedImage(100, 100, BufferedImage.TYPE_INT_RGB);
        for (int x = 0; x < 100; x++) {
            for (int y = 0; y < 100; y++) {
                int v = 70 + x * 140 / 99; // 70..210
                dull.setRGB(x, y, (v << 16) | (v << 8) | v);
            }
        }
        var out = CardScanImages.autoLevels(dull);
        int darkest = out.getRGB(0, 0) & 0xff;
        int brightest = out.getRGB(99, 0) & 0xff;
        assertTrue(darkest < 70 && brightest > 210, darkest + " / " + brightest);
        // A full stretch would need a gain of 1.8; capped at 1.25 the range stays inside 0..255.
        assertTrue(darkest > 0 && brightest < 255, darkest + " / " + brightest);
    }
}
