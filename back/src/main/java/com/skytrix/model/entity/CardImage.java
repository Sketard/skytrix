package com.skytrix.model.entity;

import com.skytrix.model.enums.ImageSource;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Getter
@Setter
public class CardImage {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private Long imageId;
    private String url;
    private String smallUrl;
    private boolean local;
    private boolean smallLocal;
    @ManyToOne
    private Card card;
    private boolean tcgUpdated;
    @Enumerated(EnumType.STRING)
    @Builder.Default
    private ImageSource source = ImageSource.YGOPRODECK;
    /** Yugipedia file name of the scan this image was built from ({@link ImageSource#YUGIPEDIA} only). */
    private String sourceFile;

    public boolean isFromYgoprodeck() {
        return source == null || source == ImageSource.YGOPRODECK;
    }
}
