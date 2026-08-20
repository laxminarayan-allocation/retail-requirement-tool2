from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

APP_VERSION = "1.0.0"


class Settings(BaseSettings):
    # Oracle
    oracle_user: str = ""
    oracle_password: SecretStr = SecretStr("")
    oracle_host: str = ""
    oracle_port: int = 1521
    oracle_service_name: str = ""

    # Oracle connection pool sizing
    oracle_pool_min: int = 1
    oracle_pool_max: int = 5

    # Thick mode for old Oracle password verifiers (DPY-3015)
    oracle_thick_mode: bool = False
    oracle_client_lib_dir: str = ""

    # Application
    app_env: str = "development"
    app_version: str = APP_VERSION
    app_port: int = 8000
    log_level: str = "INFO"
    log_json: bool = False   # set to True in production for structured JSON logs

    # Auth
    jwt_secret: SecretStr = SecretStr("change-me-in-production-use-a-long-random-string")
    jwt_expire_hours: int = 12
    allowed_email_domains: str = "citykart.org,citykartstores.com"
    admin_email: str = "laxmi.narayan@citykart.org"

    # SMTP — for OTP emails
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_from: str = ""         # defaults to smtp_user if blank
    smtp_tls: bool = True       # STARTTLS on port 587
    smtp_ssl: bool = False      # SSL on port 465
    otp_expire_minutes: int = 10

    # AI Assistant
    anthropic_api_key: SecretStr = SecretStr("")

    # CORS origins as comma-separated string from env, parsed into list
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    @property
    def smtp_from_address(self) -> str:
        return self.smtp_from or self.smtp_user

    @property
    def is_smtp_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_user)

    @property
    def allowed_domains_list(self) -> List[str]:
        return [d.strip().lower() for d in self.allowed_email_domains.split(",") if d.strip()]

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def oracle_dsn(self) -> str:
        return f"{self.oracle_host}:{self.oracle_port}/{self.oracle_service_name}"

    @property
    def is_oracle_configured(self) -> bool:
        return bool(self.oracle_user and self.oracle_host and self.oracle_service_name)

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"


settings = Settings()
