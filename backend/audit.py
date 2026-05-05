import logging
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from models import AuditLog

logger = logging.getLogger(__name__)


async def log_audit(
    db: AsyncSession,
    action: str,
    admin_id: Optional[str] = None,
    target_id: Optional[str] = None,
    details: Optional[dict] = None,
    ip_address: Optional[str] = None,
) -> None:
    try:
        details_obj = dict(details or {})
        if ip_address:
            details_obj["ip"] = ip_address
        db.add(AuditLog(
            admin_id=admin_id,
            action=action,
            target_id=target_id,
            details=details_obj,
        ))
        await db.commit()
    except Exception as e:
        logger.warning("audit_log_failed action=%s error=%s", action, str(e))
