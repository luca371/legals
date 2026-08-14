package com.rlsg.clm_mvp1.user.entity;

import com.rlsg.clm_mvp1.tenant.entity.Tenant;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(
        name = "app_user",
        uniqueConstraints = {
                @UniqueConstraint(
                        name = "uk_app_user_tenant_username",
                        columnNames = {"tenant_id", "username"}
                ),
                @UniqueConstraint(
                        name = "uk_app_user_tenant_email",
                        columnNames = {"tenant_id", "email"}
                )
        }
)
@Getter
@Setter
public class AppUser {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(
            name = "id",
            nullable = false,
            updatable = false
    )
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(
            name = "tenant_id",
            nullable = false
    )
    private Tenant tenant;

    @Column(
            name = "username",
            nullable = false,
            length = 100
    )
    private String username;

    @Column(
            name = "name",
            nullable = false,
            length = 255
    )
    private String name;

    @Column(
            name = "email",
            nullable = false,
            length = 255
    )
    private String email;

    @Column(
            name = "mobile",
            length = 50
    )
    private String mobile;

    @Column(
            name = "federation_id",
            length = 255
    )
    private String federationId;

    @Column(
            name = "password_hash",
            length = 255
    )
    private String passwordHash;

    @Column(
            name = "language",
            nullable = false,
            length = 20
    )
    private String language = "en";

    @Column(
            name = "timezone",
            nullable = false,
            length = 100
    )
    private String timezone = "UTC";

    @Column(
            name = "status",
            nullable = false,
            length = 50
    )
    private String status = "ACTIVE";

    @Column(
            name = "active",
            nullable = false
    )
    private Boolean active = true;

    @CreationTimestamp
    @Column(
            name = "created_at",
            nullable = false,
            updatable = false
    )
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(
            name = "updated_at",
            nullable = false
    )
    private LocalDateTime updatedAt;
}