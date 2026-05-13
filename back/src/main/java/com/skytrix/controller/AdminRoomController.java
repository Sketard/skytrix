package com.skytrix.controller;

import jakarta.validation.constraints.Pattern;

import org.springframework.http.HttpStatus;
import org.springframework.security.access.annotation.Secured;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.skytrix.service.RoomService;

import lombok.RequiredArgsConstructor;

/**
 * Admin-only room operations. Route-level @Secured ensures only ROLE_ADMIN
 * authorities reach handlers — non-admin users get 403 before the method
 * body runs.
 */
@RestController
@RequestMapping("/admin/rooms")
@Validated
@RequiredArgsConstructor
@Secured("ROLE_ADMIN")
public class AdminRoomController {

    private final RoomService roomService;

    @DeleteMapping("/{roomCode}")
    @ResponseStatus(code = HttpStatus.NO_CONTENT)
    public void forceCloseRoom(
            @PathVariable("roomCode") @Pattern(regexp = "[A-Z2-9]{6}") String roomCode) {
        roomService.forceCloseRoom(roomCode);
    }
}
