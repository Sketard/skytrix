package com.skytrix.controller;

import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Pattern;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.skytrix.model.dto.room.CreateRoomDTO;
import com.skytrix.model.dto.room.JoinRoomDTO;
import com.skytrix.model.dto.room.RoomDTO;
import com.skytrix.security.AuthService;
import com.skytrix.service.RoomEventService;
import com.skytrix.service.RoomService;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/rooms")
@Validated
@RequiredArgsConstructor
public class RoomController {

    private final RoomService roomService;
    private final AuthService authService;
    private final RoomEventService roomEventService;

    @PostMapping
    @ResponseStatus(code = HttpStatus.CREATED)
    public RoomDTO createRoom(@RequestBody @Valid CreateRoomDTO dto) {
        return roomService.createRoom(dto);
    }

    @PostMapping("/{roomCode}/join")
    @ResponseStatus(code = HttpStatus.OK)
    public RoomDTO joinRoom(
            @PathVariable("roomCode") @Pattern(regexp = "[A-Z2-9]{6}") String roomCode,
            @RequestBody @Valid JoinRoomDTO dto) {
        return roomService.joinRoom(roomCode, dto);
    }

    @GetMapping
    @ResponseStatus(code = HttpStatus.OK)
    public List<RoomDTO> listOpenRooms() {
        return roomService.listOpenRooms();
    }

    @GetMapping("/{roomCode}")
    @ResponseStatus(code = HttpStatus.OK)
    public RoomDTO getRoom(
            @PathVariable("roomCode") @Pattern(regexp = "[A-Z2-9]{6}") String roomCode) {
        var userId = authService.getConnectedUserId();
        return roomService.getRoom(roomCode, userId);
    }

    @GetMapping(value = "/{roomCode}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter roomEvents(
            @PathVariable("roomCode") @Pattern(regexp = "[A-Z2-9]{6}") String roomCode) {
        var userId = authService.getConnectedUserId();
        var room = roomService.getRoom(roomCode, userId);
        return roomEventService.subscribe(roomCode, room, userId);
    }

    @PostMapping("/{roomCode}/end")
    @ResponseStatus(code = HttpStatus.OK)
    public void endRoom(
            @PathVariable("roomCode") @Pattern(regexp = "[A-Z2-9]{6}") String roomCode) {
        roomService.endRoom(roomCode);
    }
}
