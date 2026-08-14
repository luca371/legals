package com.rlsg.clm_mvp1.user.repository;

import com.rlsg.clm_mvp1.user.entity.AppUser;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface AppUserRepository
        extends JpaRepository<AppUser, UUID> {

    boolean existsByTenant_IdAndUsername(
            UUID tenantId,
            String username
    );

    boolean existsByTenant_IdAndEmail(
            UUID tenantId,
            String email
    );

    Page<AppUser> findByTenant_Id(
            UUID tenantId,
            Pageable pageable
    );
}