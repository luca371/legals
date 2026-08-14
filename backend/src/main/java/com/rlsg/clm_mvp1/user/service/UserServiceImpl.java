package com.rlsg.clm_mvp1.user.service;

import com.rlsg.clm_mvp1.common.exception.DuplicateResourceException;
import com.rlsg.clm_mvp1.common.exception.ResourceNotFoundException;
import com.rlsg.clm_mvp1.tenant.entity.Tenant;
import com.rlsg.clm_mvp1.tenant.repository.TenantRepository;
import com.rlsg.clm_mvp1.user.dto.UserCreateRequest;
import com.rlsg.clm_mvp1.user.dto.UserResponse;
import com.rlsg.clm_mvp1.user.dto.UserUpdateRequest;
import com.rlsg.clm_mvp1.user.entity.AppUser;
import com.rlsg.clm_mvp1.user.mapper.UserMapper;
import com.rlsg.clm_mvp1.user.repository.AppUserRepository;

import lombok.RequiredArgsConstructor;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional
public class UserServiceImpl implements UserService {

    private final AppUserRepository userRepository;
    private final TenantRepository tenantRepository;
    private final UserMapper userMapper;
    private final PasswordEncoder passwordEncoder;

    /**
     * Create a new user.
     */
    @Override
    public UserResponse create(UserCreateRequest request) {

        // Validate tenant
        Tenant tenant = tenantRepository
                .findById(request.tenantId())
                .orElseThrow(() ->
                        new ResourceNotFoundException(
                                "Tenant not found: " + request.tenantId()
                        )
                );

        // Check duplicate username within tenant
        if (userRepository.existsByTenant_IdAndUsername(
                request.tenantId(),
                request.username()
        )) {

            throw new DuplicateResourceException(
                    "Username already exists for this tenant: "
                            + request.username()
            );
        }

        // Check duplicate email within tenant
        if (userRepository.existsByTenant_IdAndEmail(
                request.tenantId(),
                request.email()
        )) {

            throw new DuplicateResourceException(
                    "Email already exists for this tenant: "
                            + request.email()
            );
        }

        // Convert request to entity
        AppUser user = userMapper.toEntity(request);

        // Set tenant relationship
        user.setTenant(tenant);

        // Hash password before saving
        if (request.password() != null
                && !request.password().isBlank()) {

            user.setPasswordHash(
                    passwordEncoder.encode(request.password())
            );
        }

        // Save user
        AppUser savedUser = userRepository.save(user);

        // Return response
        return userMapper.toResponse(savedUser);
    }

    /**
     * Get user by ID.
     */
    @Override
    @Transactional(readOnly = true)
    public UserResponse getById(UUID id) {

        AppUser user = userRepository
                .findById(id)
                .orElseThrow(() ->
                        new ResourceNotFoundException(
                                "User not found: " + id
                        )
                );

        return userMapper.toResponse(user);
    }

    /**
     * Get all users for a specific tenant.
     */
    @Override
    @Transactional(readOnly = true)
    public Page<UserResponse> getAll(
            UUID tenantId,
            Pageable pageable
    ) {

        // Validate tenant exists
        if (!tenantRepository.existsById(tenantId)) {
            throw new ResourceNotFoundException(
                    "Tenant not found: " + tenantId
            );
        }

        return userRepository
                .findByTenant_Id(
                        tenantId,
                        pageable
                )
                .map(userMapper::toResponse);
    }

    /**
     * Update an existing user.
     */
    @Override
    public UserResponse update(
            UUID id,
            UserUpdateRequest request
    ) {

        AppUser user = userRepository
                .findById(id)
                .orElseThrow(() ->
                        new ResourceNotFoundException(
                                "User not found: " + id
                        )
                );

        if (request.name() != null) {
            user.setName(request.name());
        }

        if (request.email() != null) {

            /*
             * Before changing email, check whether
             * the email already exists for this tenant.
             */
            if (!user.getEmail().equalsIgnoreCase(request.email())
                    && userRepository.existsByTenant_IdAndEmail(
                    user.getTenant().getId(),
                    request.email()
            )) {

                throw new DuplicateResourceException(
                        "Email already exists for this tenant: "
                                + request.email()
                );
            }

            user.setEmail(request.email());
        }

        if (request.mobile() != null) {
            user.setMobile(request.mobile());
        }

        if (request.federationId() != null) {
            user.setFederationId(request.federationId());
        }

        if (request.language() != null) {
            user.setLanguage(request.language());
        }

        if (request.timezone() != null) {
            user.setTimezone(request.timezone());
        }

        if (request.status() != null) {
            user.setStatus(request.status());
        }

        if (request.active() != null) {
            user.setActive(request.active());
        }

        AppUser updatedUser = userRepository.save(user);

        return userMapper.toResponse(updatedUser);
    }

    /**
     * Deactivate a user.
     */
    @Override
    public void deactivate(UUID id) {

        AppUser user = userRepository
                .findById(id)
                .orElseThrow(() ->
                        new ResourceNotFoundException(
                                "User not found: " + id
                        )
                );

        user.setActive(false);
        user.setStatus("INACTIVE");

        userRepository.save(user);
    }
}