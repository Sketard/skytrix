package com.skytrix.service.artwork;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;

/**
 * Image work on card pictures, JDK only.
 *
 * <ul>
 *   <li>{@link #artworkHash}: perceptual hash (dHash 16×16 = 256 bits) of the illustration box of a card, to tell
 *       whether a Yugipedia scan shows an artwork we already have. Same artwork ≤ ~90, different ≥ ~102
 *       (prototype measures, {@code work/yugipedia-artworks/README.md}).</li>
 *   <li>{@link #toCardImage}: turns a scan into a picture shaped like our YGOPRODeck renders (option B: transparent
 *       corners flattened, exact size, mild level correction).</li>
 * </ul>
 */
public final class CardScanImages {
    /** Size of the YGOPRODeck renders stored in {@code images/big}. */
    public static final int BIG_WIDTH = 813;
    public static final int BIG_HEIGHT = 1185;
    /** Size of the thumbnails stored in {@code images/small}. */
    public static final int SMALL_WIDTH = 268;
    public static final int SMALL_HEIGHT = 391;

    /** Illustration box of a standard card frame, as fractions of the card. */
    private static final double BOX_LEFT = 0.12;
    private static final double BOX_TOP = 0.185;
    private static final double BOX_RIGHT = 0.88;
    private static final double BOX_BOTTOM = 0.70;
    private static final int HASH_SIZE = 16;
    /** Distance (out of 256 bits) under which two illustrations are the same artwork. */
    public static final int SAME_ARTWORK_MAX_DISTANCE = 95;

    /** Scan corners are often transparent (rounded card); they get the dark tone of a card edge. */
    private static final Color CORNER = new Color(0x1c, 0x1c, 0x1c);
    private static final double MAX_LEVEL_GAIN = 1.25;

    private CardScanImages() {
    }

    public static BufferedImage read(byte[] bytes) {
        try {
            var image = ImageIO.read(new ByteArrayInputStream(bytes));
            if (image == null) {
                throw new IllegalArgumentException("Unsupported image format");
            }
            return image;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** dHash of the illustration box: each bit says whether a cell is brighter than its right neighbour. */
    public static boolean[] artworkHash(BufferedImage card) {
        int w = card.getWidth();
        int h = card.getHeight();
        int x0 = (int) Math.round(w * BOX_LEFT);
        int y0 = (int) Math.round(h * BOX_TOP);
        int bw = (int) Math.round(w * (BOX_RIGHT - BOX_LEFT));
        int bh = (int) Math.round(h * (BOX_BOTTOM - BOX_TOP));

        var grey = new double[bh][bw];
        double min = 255;
        double max = 0;
        for (int y = 0; y < bh; y++) {
            for (int x = 0; x < bw; x++) {
                int rgb = card.getRGB(x0 + x, y0 + y);
                double l = 0.299 * ((rgb >> 16) & 0xff) + 0.587 * ((rgb >> 8) & 0xff) + 0.114 * (rgb & 0xff);
                grey[y][x] = l;
                min = Math.min(min, l);
                max = Math.max(max, l);
            }
        }
        double range = Math.max(1, max - min);

        // Box-average down to (HASH_SIZE + 1) × HASH_SIZE cells, after normalising the levels.
        int cols = HASH_SIZE + 1;
        var cells = new double[HASH_SIZE][cols];
        for (int cy = 0; cy < HASH_SIZE; cy++) {
            int ya = cy * bh / HASH_SIZE;
            int yb = Math.max(ya + 1, (cy + 1) * bh / HASH_SIZE);
            for (int cx = 0; cx < cols; cx++) {
                int xa = cx * bw / cols;
                int xb = Math.max(xa + 1, (cx + 1) * bw / cols);
                double sum = 0;
                for (int y = ya; y < yb; y++) {
                    for (int x = xa; x < xb; x++) {
                        sum += (grey[y][x] - min) / range;
                    }
                }
                cells[cy][cx] = sum / ((yb - ya) * (xb - xa));
            }
        }
        var bits = new boolean[HASH_SIZE * HASH_SIZE];
        for (int y = 0; y < HASH_SIZE; y++) {
            for (int x = 0; x < HASH_SIZE; x++) {
                bits[y * HASH_SIZE + x] = cells[y][x] > cells[y][x + 1];
            }
        }
        return bits;
    }

    public static int distance(boolean[] a, boolean[] b) {
        int d = 0;
        for (int i = 0; i < a.length; i++) {
            if (a[i] != b[i]) {
                d++;
            }
        }
        return d;
    }

    /** Scan → opaque RGB picture of the given size, levels lightly stretched. */
    public static BufferedImage toCardImage(BufferedImage scan, int width, int height) {
        return autoLevels(resize(flatten(scan), width, height));
    }

    public static BufferedImage resize(BufferedImage source, int width, int height) {
        var current = source;
        // Halve step by step first: a single bicubic pass from ~1100 px to 268 px aliases.
        while (current.getWidth() / 2 >= width && current.getHeight() / 2 >= height) {
            current = draw(current, current.getWidth() / 2, current.getHeight() / 2, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        }
        return draw(current, width, height, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
    }

    public static byte[] jpeg(BufferedImage image, float quality) {
        var writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        var out = new ByteArrayOutputStream();
        try (var ios = ImageIO.createImageOutputStream(out)) {
            writer.setOutput(ios);
            var param = writer.getDefaultWriteParam();
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(quality);
            writer.write(null, new IIOImage(image, null, null), param);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } finally {
            writer.dispose();
        }
        return out.toByteArray();
    }

    private static BufferedImage flatten(BufferedImage scan) {
        var rgb = new BufferedImage(scan.getWidth(), scan.getHeight(), BufferedImage.TYPE_INT_RGB);
        var g = rgb.createGraphics();
        g.setColor(CORNER);
        g.fillRect(0, 0, scan.getWidth(), scan.getHeight());
        g.drawImage(scan, 0, 0, null);
        g.dispose();
        return rgb;
    }

    private static BufferedImage draw(BufferedImage source, int width, int height, Object interpolation) {
        var target = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = target.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, interpolation);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.drawImage(source, 0, 0, width, height, null);
        g.dispose();
        return target;
    }

    /**
     * Scans come out a little dull (paper, lighting): stretch the luminance between its 0.5 % and 99.5 %
     * percentiles, gain capped so a dark card does not get washed out.
     */
    static BufferedImage autoLevels(BufferedImage image) {
        int w = image.getWidth();
        int h = image.getHeight();
        var histogram = new int[256];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                histogram[luma(image.getRGB(x, y))]++;
            }
        }
        int total = w * h;
        int low = percentile(histogram, total, 0.005);
        int high = percentile(histogram, total, 0.995);
        if (high - low < 32) {
            return image;
        }
        double fullGain = 255.0 / (high - low);
        double middle = (low + high) / 2.0;
        var lut = new int[256];
        for (int v = 0; v < 256; v++) {
            // Full stretch when it is mild; otherwise capped gain around the measured middle, which stays put.
            double mapped = fullGain <= MAX_LEVEL_GAIN
                    ? (v - low) * fullGain
                    : (v - middle) * MAX_LEVEL_GAIN + middle;
            lut[v] = clamp((int) Math.round(mapped));
        }
        var out = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int rgb = image.getRGB(x, y);
                out.setRGB(x, y, (lut[(rgb >> 16) & 0xff] << 16) | (lut[(rgb >> 8) & 0xff] << 8) | lut[rgb & 0xff]);
            }
        }
        return out;
    }

    private static int luma(int rgb) {
        return clamp((int) Math.round(0.299 * ((rgb >> 16) & 0xff) + 0.587 * ((rgb >> 8) & 0xff) + 0.114 * (rgb & 0xff)));
    }

    private static int percentile(int[] histogram, int total, double fraction) {
        long target = Math.round(total * fraction);
        long seen = 0;
        for (int v = 0; v < 256; v++) {
            seen += histogram[v];
            if (seen > target) {
                return v;
            }
        }
        return 255;
    }

    private static int clamp(int v) {
        return Math.max(0, Math.min(255, v));
    }
}
