package com.rlsg.clm_mvp1.tenant.repository;

import com.rlsg.clm_mvp1.tenant.entity.Tenant;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface TenantRepository
        extends JpaRepository<Tenant, UUID> {

    boolean existsByCode(String code);

    boolean existsByCodeAndIdNot(
            String code,
            UUID id
    );

    Optional<Tenant> findByCode(String code);
}