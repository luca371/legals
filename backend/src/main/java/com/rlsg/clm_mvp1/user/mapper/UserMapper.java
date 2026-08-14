package com.rlsg.clm_mvp1.user.mapper;

import com.rlsg.clm_mvp1.user.dto.UserCreateRequest;
import com.rlsg.clm_mvp1.user.dto.UserResponse;
import com.rlsg.clm_mvp1.user.entity.AppUser;
import org.springframework.stereotype.Component;

@Component
public class UserMapper {

    public AppUser toEntity(
            UserCreateRequest request
    ) {

        AppUser user = new AppUser();

        user.setUsername(request.username());
        user.setName(request.name());
        user.setEmail(request.email());
        user.setMobile(request.mobile());
        user.setFederationId(request.federationId());

        user.setLanguage(
                request.language() != null
                        ? request.language()
                        : "en"
        );

        user.setTimezone(
                request.timezone() != null
                        ? request.timezone()
                        : "UTC"
        );

        user.setStatus("ACTIVE");
        user.setActive(true);

        return user;
    }

    public UserResponse toResponse(
            AppUser user
    ) {

        return new UserResponse(
                user.getId(),

                user.getTenant().getId(),

                user.getUsername(),

                user.getName(),

                user.getEmail(),

                user.getMobile(),

                user.getFederationId(),

                user.getLanguage(),

                user.getTimezone(),

                user.getStatus(),

                user.getActive(),

                user.getCreatedAt(),

                user.getUpdatedAt()
        );
    }
}