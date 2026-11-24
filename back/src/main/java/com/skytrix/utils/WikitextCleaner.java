package com.skytrix.utils;

import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns the wikitext Yugipedia stores in its card properties into plain text.
 *
 * <p>Only a closed list of HTML tags is removed: card texts legitimately contain
 * angle brackets (e.g. {@code <O/N>} in Qliphort lore, {@code <C>} in Maliss names).
 */
public final class WikitextCleaner {
    private static final Pattern BR = Pattern.compile("<br\\s*/?>", Pattern.CASE_INSENSITIVE);
    private static final Pattern KNOWN_TAGS = Pattern.compile(
            "</?(?:i|b|u|s|small|big|sup|sub|span|div|p|nowiki|center)(?:\\s[^>]*)?/?>", Pattern.CASE_INSENSITIVE);
    private static final Pattern LINK_WITH_LABEL = Pattern.compile("\\[\\[[^\\]|]*\\|([^\\]]*)]]");
    private static final Pattern LINK = Pattern.compile("\\[\\[([^\\]]*)]]");
    private static final Pattern BOLD_ITALIC = Pattern.compile("'{2,}");
    private static final Pattern NUMERIC_ENTITY = Pattern.compile("&#(x?)([0-9a-fA-F]+);");
    private static final Pattern NAMED_ENTITY = Pattern.compile("&([a-zA-Z]+);");
    private static final Pattern SPACES_AROUND_NEWLINE = Pattern.compile("[ \\t]*\\n[ \\t]*");
    private static final Map<String, String> NAMED_ENTITIES = Map.of(
            "amp", "&", "lt", "<", "gt", ">", "quot", "\"", "apos", "'", "nbsp", " ");

    private WikitextCleaner() {
    }

    public static String clean(String wikitext) {
        if (wikitext == null) {
            return null;
        }
        var text = BR.matcher(wikitext).replaceAll("\n");
        text = KNOWN_TAGS.matcher(text).replaceAll("");
        text = LINK_WITH_LABEL.matcher(text).replaceAll(m -> Matcher.quoteReplacement(m.group(1)));
        text = LINK.matcher(text).replaceAll(m -> Matcher.quoteReplacement(m.group(1)));
        text = BOLD_ITALIC.matcher(text).replaceAll("");
        // Entities last, so a decoded "&lt;i&gt;" stays literal text.
        text = NUMERIC_ENTITY.matcher(text).replaceAll(m -> {
            var codePoint = Integer.parseInt(m.group(2), m.group(1).isEmpty() ? 10 : 16);
            return Matcher.quoteReplacement(new String(Character.toChars(codePoint)));
        });
        text = NAMED_ENTITY.matcher(text).replaceAll(m ->
                Matcher.quoteReplacement(NAMED_ENTITIES.getOrDefault(m.group(1), m.group())));
        text = SPACES_AROUND_NEWLINE.matcher(text).replaceAll("\n");
        return text.strip();
    }
}
