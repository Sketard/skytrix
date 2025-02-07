package com.skytrix.utils;

import static com.skytrix.utils.CoreUtils.mapToList;

import java.util.List;
import java.util.function.Function;
import java.util.function.Supplier;

import org.springframework.data.domain.Page;

import lombok.Data;

@Data
public class CustomPageable<T> {
    private List<T> elements;
    private long size;

    public <R> CustomPageable(Supplier<Page<R>> supplier, Function<R, T> mappingFunction) {
        var page = supplier.get();
        var elementsFound = page.getContent();
        size = page.getTotalElements();
        elements = mapToList(elementsFound, mappingFunction);
    }
}
