package com.skytrix.controller;

import jakarta.validation.Valid;

import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.skytrix.model.dto.room.QuickDuelDTO;
import com.skytrix.model.dto.room.QuickDuelResponseDTO;
import com.skytrix.service.RoomService;

import lombok.RequiredArgsConstructor;

@Profile("!prod")
@RestController
@RequestMapping("/rooms")
@RequiredArgsConstructor
public class DevRoomController {

    private final RoomService roomService;

    @PostMapping("/quick-duel")
    @ResponseStatus(HttpStatus.OK)
    public QuickDuelResponseDTO quickDuel(@Valid @RequestBody QuickDuelDTO dto) {
        return roomService.quickDuel(dto);
    }
}
