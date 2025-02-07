package com.skytrix.repository;

import com.skytrix.model.entity.CardImage;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.repository.CrudRepository;

import java.util.List;

public interface CardImageRepository extends CrudRepository<CardImage, Long> {
    Page<CardImage> findAllByLocal(boolean local, Pageable page);

    Page<CardImage> findAllBySmallLocal(boolean local, Pageable page);

    List<CardImage> findAllByIdIn(List<Long> ids);

	List<CardImage> findAllByTcgUpdatedAndCardFirstTcgReleaseIsNotNull(boolean b);

	Page<CardImage> findAllBySmallLocalOrLocal(boolean smallLocal, boolean local, PageRequest of);
}
