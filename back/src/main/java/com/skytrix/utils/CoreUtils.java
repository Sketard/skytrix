package com.skytrix.utils;

import static java.util.stream.Collectors.counting;
import static java.util.stream.Collectors.groupingBy;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.stream.Collectors;

public abstract class CoreUtils {
    public static <R, T> List<R> mapToList(List<T> elements, Function<T, R> mappingFunction) {
        Objects.requireNonNull(elements);
        if (elements.isEmpty()) {
            return new ArrayList<>();
        }
        return elements.stream().map(mappingFunction).collect(Collectors.toList());
    }

    public static Map<Long, Long> countMap(List<Long> values) {
        return  values.stream().collect(groupingBy(Function.identity(), counting()));
    }

    public static <T> List<T> filter(List<T> elements, Predicate<T> predicate) {
        return elements.stream().filter(predicate).collect(Collectors.toList());
    }

    public static <T> T findAny(List<T> elements, Predicate<T> predicate) {
        return elements.stream().filter(predicate).findAny().orElseThrow();
    }

    public static <T> List<T> getNullSafe(List<T> list) {
        return Optional.ofNullable(list).orElse(new ArrayList<>());
    }

    CoreUtils() { }
}
