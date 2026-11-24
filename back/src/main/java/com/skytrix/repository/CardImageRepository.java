package com.skytrix.repository;

import com.skytrix.model.entity.CardImage;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface CardImageRepository extends CrudRepository<CardImage, Long> {
    Page<CardImage> findAllByLocal(boolean local, Pageable page);

    Page<CardImage> findAllBySmallLocal(boolean local, Pageable page);

    List<CardImage> findAllByIdIn(List<Long> ids);

    // The YGOPRODeck image flows only ever see YGOPRODeck rows: a Yugipedia artwork has no
    // YGOPRODeck file to download, and its file must never be overwritten by a YGOPRODeck render.
    @Query("select ci from CardImage ci where ci.source = com.skytrix.model.enums.ImageSource.YGOPRODECK"
            + " and ci.tcgUpdated = false and ci.card.firstTcgRelease is not null")
    List<CardImage> findYgoproImagesToUpdateForTcg();

    @Query("select ci from CardImage ci where ci.source = com.skytrix.model.enums.ImageSource.YGOPRODECK"
            + " and (ci.smallLocal = :smallLocal or ci.local = :local) order by ci.id")
    Page<CardImage> findYgoproImagesBySmallLocalOrLocal(@Param("smallLocal") boolean smallLocal,
                                                        @Param("local") boolean local, Pageable page);
}
