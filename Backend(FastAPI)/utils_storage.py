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
              ti.map_server,
              ti.task_source,
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
        if row is not None:
            columns = [desc[0] for desc in cursor.description]
            return dict(zip(columns, row))

        cursor.execute(
            """
            SELECT
              NULL AS task_item_id,
              NULL AS file_id,
              t.local_image_path,
              t.map_server,
              t.task_source,
              NULL AS storage_type,
              NULL AS bucket_name,
              NULL AS object_key,
              NULL AS file_name,
              NULL AS original_filename
            FROM task t
            WHERE t.task_id = %s
            LIMIT 1
            """,
            (task_id,),
        )
        fallback_row = cursor.fetchone()
        if fallback_row is None:
            return None
        columns = [desc[0] for desc in cursor.description]
        return dict(zip(columns, fallback_row))


def _append_image_candidates(candidates, raw_path: str):
    text = str(raw_path or "").strip()
    if not text:
        return
    normalized = os.path.normpath(text.replace("\\", os.sep).replace("/", os.sep))
    entries = [text, normalized]
    for entry in entries:
        lower = entry.lower()
        if lower.endswith((".tif", ".tiff")):
            candidates.append(entry)
            stem, _ = os.path.splitext(entry)
            candidates.append(stem)
        else:
            candidates.append(entry + ".tif")
            candidates.append(entry + ".tiff")
            candidates.append(entry)


def _collect_image_candidates(base_path: str):
    text = str(base_path or "").strip()
    if not text:
        return []

    candidates = []
    _append_image_candidates(candidates, text)

    normalized = os.path.normpath(text.replace("\\", os.sep).replace("/", os.sep))
    base_name = os.path.basename(normalized.rstrip("\\/"))
    extra_dirs = [
        _get_env("MINIO_UPLOAD_DIR", ""),
        _get_env("GEOSERVER_LOCAL_COVERAGE_DIR", ""),
    ]
    for root_dir in extra_dirs:
        if not root_dir:
            continue
        if not os.path.isabs(normalized):
            _append_image_candidates(candidates, os.path.join(root_dir, normalized))
        if base_name:
            _append_image_candidates(candidates, os.path.join(root_dir, base_name))

    return list(dict.fromkeys([item for item in candidates if item]))


def _resolve_existing_image_path(base_path: str):
    candidates = _collect_image_candidates(base_path)
    for candidate in candidates:
        if os.path.isfile(candidate) and os.access(candidate, os.R_OK):
            return candidate, candidates
    return "", candidates


def ensure_task_image_local(conn, task_id: int, task_item_id, fallback_path: str = "") -> str:
    record = fetch_task_file_record(conn, task_id, task_item_id)
    cache_dir = get_cache_dir("imagery")
    unresolved_candidates = []

    if record:
        storage_type = str(record.get("storage_type") or "").strip().lower()
        if record.get("object_key") or storage_type == "minio":
            return resolve_storage_to_local(record, cache_dir, fallback_path="")

        for path_value in (
            record.get("local_image_path"),
            record.get("map_server"),
            fallback_path,
        ):
            resolved_path, candidates = _resolve_existing_image_path(path_value)
            unresolved_candidates.extend(candidates)
            if resolved_path:
                return resolved_path

    resolved_fallback, fallback_candidates = _resolve_existing_image_path(fallback_path)
    unresolved_candidates.extend(fallback_candidates)
    if resolved_fallback:
        return resolved_fallback

    dedup_candidates = list(dict.fromkeys([item for item in unresolved_candidates if item]))
    raise FileNotFoundError(f"未找到可读取影像文件，候选路径: {dedup_candidates}")


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
