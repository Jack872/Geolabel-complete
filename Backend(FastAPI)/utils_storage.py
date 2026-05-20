import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None
from minio import Minio


_MINIO_CLIENT = None
_ENV_LOADED = False


def _load_env_once():
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    current_dir = Path(__file__).resolve().parent
    candidates = [
        current_dir / ".env",
        current_dir.parent / ".env",
    ]
    for env_path in candidates:
        if env_path.exists():
            if load_dotenv is not None:
                load_dotenv(dotenv_path=env_path, override=False)
            break
    _ENV_LOADED = True


_load_env_once()


def _get_env(name: str, default: str = "") -> str:
    value = os.getenv(name, default)
    return value.strip() if isinstance(value, str) else value


def _get_required_env(name: str) -> str:
    value = _get_env(name, "")
    if not value:
        raise RuntimeError(
            f"缺少必需配置 {name}。请在 Backend(FastAPI)/.env 或进程环境变量中显式设置。"
        )
    return value


def get_cache_dir(subdir: str) -> Path:
    base = Path(_get_env("GEOLABEL_CACHE_DIR", "/opt/geolabel/cache"))
    path = base / subdir
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_model_cache_dir() -> Path:
    path = Path(_get_env("MODEL_CACHE_DIR", str(get_cache_dir("models"))))
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_minio_client() -> Minio:
    global _MINIO_CLIENT
    if _MINIO_CLIENT is not None:
        return _MINIO_CLIENT
    endpoint = _get_required_env("MINIO_ENDPOINT")
    secure = endpoint.startswith("https://")
    endpoint = endpoint.replace("http://", "").replace("https://", "")
    if not endpoint:
        raise RuntimeError("MINIO_ENDPOINT 配置无效，不能为空")
    _MINIO_CLIENT = Minio(
        endpoint,
        access_key=_get_required_env("MINIO_ACCESS_KEY"),
        secret_key=_get_required_env("MINIO_SECRET_KEY"),
        secure=secure,
    )
    return _MINIO_CLIENT


def resolve_storage_to_local(record: dict, cache_dir: Path, fallback_path: str = "") -> str:
    if not record:
        if fallback_path:
            return fallback_path
        raise FileNotFoundError("record 为空，无法解析本地文件")

    storage_type = str(record.get("storage_type") or "").strip().lower()
    bucket_name = str(record.get("bucket_name") or _get_required_env("MINIO_BUCKET")).strip()
    object_key = str(record.get("object_key") or "").strip()
    file_name = str(record.get("file_name") or record.get("original_filename") or "").strip()

    if object_key or storage_type == "minio":
        object_name = object_key or file_name
        if not object_name:
            raise FileNotFoundError("MinIO 对象键为空")
        target_name = file_name or Path(object_name).name
        target_path = cache_dir / target_name
        if not target_path.exists() or target_path.stat().st_size == 0:
            client = get_minio_client()
            client.fget_object(bucket_name, object_name, str(target_path))
        return str(target_path)

    legacy_path = fallback_path or str(record.get("path") or "").strip() or file_name
    if not legacy_path:
        raise FileNotFoundError("本地回退路径为空")
    return legacy_path


def fetch_task_file_record(conn, task_id: int, task_item_id=None):
    if conn is None:
        return None
    with conn.cursor() as cursor:
        query = """
            SELECT
              ti.task_item_id,
              ti.file_id,
              ti.local_image_path,
              f.storage_type,
              f.bucket_name,
              f.object_key,
              f.file_name,
              f.original_filename
            FROM task_item ti
            LEFT JOIN file f ON ti.file_id = f.file_id
            WHERE ti.task_id = %s
        """
        args = [task_id]
        if task_item_id is not None:
            query += " AND ti.task_item_id = %s"
            args.append(task_item_id)
        query += " ORDER BY ti.item_index ASC NULLS LAST, ti.task_item_id ASC LIMIT 1"
        cursor.execute(query, tuple(args))
        row = cursor.fetchone()
        if row is None:
            return None
        columns = [desc[0] for desc in cursor.description]
        return dict(zip(columns, row))


def ensure_task_image_local(conn, task_id: int, task_item_id, fallback_path: str = "") -> str:
    record = fetch_task_file_record(conn, task_id, task_item_id)
    cache_dir = get_cache_dir("imagery")
    return resolve_storage_to_local(record or {}, cache_dir, fallback_path=fallback_path)


def ensure_model_local(record: dict) -> str:
    return resolve_storage_to_local(record or {}, get_model_cache_dir(), fallback_path=str((record or {}).get("path") or ""))


def upload_local_file_to_minio(local_path: str, object_key: str, bucket_name: str = "") -> dict:
    target_bucket = (bucket_name or _get_required_env("MINIO_BUCKET")).strip()
    client = get_minio_client()
    if not client.bucket_exists(target_bucket):
        client.make_bucket(target_bucket)
    client.fput_object(target_bucket, object_key, local_path)
    return {
        "storage_type": "minio",
        "bucket_name": target_bucket,
        "object_key": object_key,
        "file_name": Path(local_path).name,
        "original_filename": Path(local_path).name,
    }
