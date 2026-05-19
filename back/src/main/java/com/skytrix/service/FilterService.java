package com.skytrix.service;

import jakarta.inject.Inject;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;

import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import static org.springframework.util.StringUtils.hasText;

import com.skytrix.model.dto.card.CardFilterDTO;
import com.skytrix.model.dto.card.CardSetFilterDTO;
import com.skytrix.model.entity.Card;
import com.skytrix.model.enums.Race;
import com.skytrix.security.AuthService;

@Service
public class FilterService {

    @Inject
    private AuthService authService;

    public Specification<Card> cardSpecification(CardFilterDTO filterDTO) {
        return (Root<Card> root, CriteriaQuery<?> query, CriteriaBuilder criteriaBuilder) -> {
            Predicate predicate = criteriaBuilder.conjunction();
			assert query != null;
			query.distinct(true);

            if (filterDTO.getMinAtk() != null) {
                predicate = criteriaBuilder.and(predicate, criteriaBuilder.greaterThanOrEqualTo(root.get("atk"), filterDTO.getMinAtk()));
            }

            if (filterDTO.getMaxAtk() != null) {
                predicate = criteriaBuilder.and(predicate, criteriaBuilder.lessThanOrEqualTo(root.get("atk"), filterDTO.getMaxAtk()));
            }

            if (filterDTO.getMinDef() != null) {
                predicate = criteriaBuilder.and(predicate, criteriaBuilder.greaterThanOrEqualTo(root.get("def"), filterDTO.getMinDef()));
            }

            if (filterDTO.getMaxDef() != null) {
                predicate = criteriaBuilder.and(predicate, criteriaBuilder.lessThanOrEqualTo(root.get("def"), filterDTO.getMaxDef()));
            }

            if (filterDTO.getAttribute() != null && !filterDTO.getAttribute().isEmpty()) {
                predicate = criteriaBuilder.and(predicate, criteriaBuilder.equal(root.get("attribute"), filterDTO.getAttribute()));
            }

            if (filterDTO.getArchetype() != null && !filterDTO.getArchetype().isEmpty()) {
                predicate = criteriaBuilder.and(predicate, criteriaBuilder.like(
                    criteriaBuilder.lower(root.get("archetype")),
                    "%" + filterDTO.getArchetype().toLowerCase() + "%")
                );
            }

            if (filterDTO.getMinScale() != null) {
                predicate = criteriaBuilder.and(predicate, criteriaBuilder.greaterThanOrEqualTo(root.get("scale"), filterDTO.getMinScale()));
            }

            if (filterDTO.getMaxScale() != null) {
                predicate = criteriaBuilder.and(predicate, criteriaBuilder.lessThanOrEqualTo(root.get("scale"), filterDTO.getMaxScale()));
            }

            if (filterDTO.getMinLinkval() != null) {
                predicate = criteriaBuilder.and(predicate, criteriaBuilder.greaterThanOrEqualTo(root.get("linkval"), filterDTO.getMinLinkval()));
            }

            if (filterDTO.getMaxLinkval() != null) {
                predicate = criteriaBuilder.and(predicate, criteriaBuilder.lessThanOrEqualTo(root.get("linkval"), filterDTO.getMaxLinkval()));
            }

            var raceFilter = filterDTO.getRaces();
            if (raceFilter != null && !raceFilter.isEmpty()) {
                var raceNames = raceFilter.stream().map(Race::name).toList();
                predicate = criteriaBuilder.and(predicate, root.get("race").in(raceNames));
            }

            if (filterDTO.isFavorite()) {
                var userFavoriteJoin = root.join("favoritedBy", JoinType.INNER);
                predicate = criteriaBuilder.and(predicate, criteriaBuilder.equal(userFavoriteJoin.get("id"), authService.getConnectedUserId()));
            }

            var typeFilter = filterDTO.getTypes();
            if (typeFilter != null && !typeFilter.isEmpty()) {
                for(var type : typeFilter) {
                    var isPresent = criteriaBuilder.greaterThan(
                            criteriaBuilder.function("array_position", Integer.class, root.get("types"), criteriaBuilder.literal(type.name())),
                            criteriaBuilder.literal(0)
                            );
                    // can i create an SQL function that filter and add it to my criteria builder
                    predicate = criteriaBuilder.and(predicate, isPresent);
                }
            }

            var cardSetFilter = filterDTO.getCardSetFilter();
            if (cardSetFilter != null && cardSetFilter.isNotEmpty()) {
                var setJoin = root.join("sets", JoinType.INNER);
                if (hasText(cardSetFilter.getCardSetCode())) {
                    predicate = criteriaBuilder.and(predicate, criteriaBuilder.like(setJoin.get("code"), "%" + cardSetFilter.getCardSetCode() + "%"));
                }
                var names = cardSetFilter.getCardSetNames();
                if (names != null && !names.isEmpty()) {
                    predicate = criteriaBuilder.and(predicate, setJoin.get("name").in(names));
                }
                if (hasText(cardSetFilter.getCardRarityCode())) {
                    predicate = criteriaBuilder.and(predicate, criteriaBuilder.equal(setJoin.get("rarityCode"), cardSetFilter.getCardRarityCode()));
                }
            }

            var filterName = filterDTO.getName();
            if (filterName != null && !filterName.isEmpty()) {
                var translationJoin = root.join("translations", JoinType.INNER);
                var likeName = criteriaBuilder.like(
                        criteriaBuilder.lower(translationJoin.get("name")),
                        "%" + filterName.toLowerCase() + "%");
                var likeDescription = criteriaBuilder.like(
                        criteriaBuilder.lower(translationJoin.get("description")),
                        "%" + filterName.toLowerCase() + "%");
                predicate = criteriaBuilder.and(predicate, criteriaBuilder.or(likeName, likeDescription));
            }
            return predicate;
        };
    }

}
