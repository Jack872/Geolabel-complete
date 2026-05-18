import os
from typing import Any, Dict, Tuple

import torch


def load_checkpoint(model_path: str) -> Any:
    """Load checkpoint from disk with consistent error message."""
    if not model_path:
        raise RuntimeError("加载模型权重失败: model_path 为空")
    if not os.path.exists(model_path):
        raise RuntimeError(f"加载模型权重失败: 文件不存在 model_path={model_path}")
    try:
        return torch.load(model_path, map_location="cpu")
    except Exception as exc:
        raise RuntimeError(f"加载模型权重失败: model_path={model_path}, error={exc}") from exc


def extract_state_dict(checkpoint: Any) -> Dict[str, Any]:
    """Extract state_dict from common checkpoint formats."""
    if isinstance(checkpoint, dict):
        for key in ("state_dict", "model_state_dict", "model", "weights"):
            candidate = checkpoint.get(key)
            if isinstance(candidate, dict) and candidate:
                return candidate

        # checkpoint itself is a raw state_dict
        if checkpoint and all(isinstance(k, str) for k in checkpoint.keys()):
            return checkpoint

    raise RuntimeError(
        "无法识别 checkpoint 结构。期望: "
        "checkpoint['state_dict'|'model_state_dict'|'model'|'weights'] 或原始参数 dict"
    )


def normalize_state_dict_keys(state_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize common prefixes (e.g. module.)."""
    if not isinstance(state_dict, dict):
        raise RuntimeError("state_dict 类型错误，必须是 dict")

    normalized = {}
    for key, value in state_dict.items():
        new_key = key
        while isinstance(new_key, str) and new_key.startswith("module."):
            new_key = new_key[len("module."):]
        normalized[new_key] = value
    return normalized


def safe_load_model_weights(model, model_path: str, strict: bool = False) -> Tuple[Any, Dict[str, Any]]:
    """Safely load torch weights and return detailed diagnostics."""
    load_info = {
        "ok": False,
        "strict": bool(strict),
        "missing_keys": [],
        "unexpected_keys": [],
        "message": "",
        "key_count": 0,
        "sample_keys": [],
        "model_path": model_path,
        "all_keys": [],
        "model_key_count": 0,
        "matched_key_count": 0,
        "matched_key_ratio": 0.0,
    }

    try:
        checkpoint = load_checkpoint(model_path)
        state_dict = extract_state_dict(checkpoint)
        normalized_state = normalize_state_dict_keys(state_dict)
        all_keys = list(normalized_state.keys())
        model_state_keys = list(model.state_dict().keys())
        model_state_key_set = set(model_state_keys)
        matched_key_count = sum(1 for key in all_keys if key in model_state_key_set)
        load_info["all_keys"] = all_keys
        load_info["key_count"] = len(all_keys)
        load_info["sample_keys"] = all_keys[:10]
        load_info["model_key_count"] = len(model_state_keys)
        load_info["matched_key_count"] = matched_key_count
        load_info["matched_key_ratio"] = (
            float(matched_key_count) / float(len(model_state_keys))
            if model_state_keys else 0.0
        )

        result = model.load_state_dict(normalized_state, strict=strict)
        missing_keys = list(getattr(result, "missing_keys", []) or [])
        unexpected_keys = list(getattr(result, "unexpected_keys", []) or [])

        load_info["ok"] = True
        load_info["missing_keys"] = missing_keys
        load_info["unexpected_keys"] = unexpected_keys
        load_info["message"] = (
            f"权重加载完成: strict={strict}, key_count={load_info['key_count']}, "
            f"missing={len(missing_keys)}, unexpected={len(unexpected_keys)}, "
            f"matched={matched_key_count}/{len(model_state_keys)}"
        )
        return model, load_info
    except Exception as exc:
        load_info["ok"] = False
        load_info["message"] = str(exc)
        return model, load_info
