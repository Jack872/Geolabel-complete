import json


SUPPORTED_RUNTIME_TYPES = {
    "yolo",
    "light_unet",
    "unet",
    "fast_scnn",
    "xgboost",
    "deeplab",
    "segformer",
    "svm",
    "sam",
}


def _as_non_empty_str(value):
    if value is None:
        return ""
    text = str(value).strip()
    return text


def _as_positive_int(value, field_name):
    try:
        parsed = int(value)
    except Exception as exc:
        raise ValueError(f"modelSpec.{field_name} 必须是正整数") from exc
    if parsed <= 0:
        raise ValueError(f"modelSpec.{field_name} 必须大于 0")
    return parsed


def _parse_json_object(raw_des):
    if raw_des is None:
        raise ValueError("model_des 为空，必须提供 modelSpec JSON")
    if isinstance(raw_des, dict):
        return raw_des
    if not isinstance(raw_des, str):
        raise ValueError("model_des 类型错误，必须是 JSON 字符串")

    text = raw_des.strip()
    if not text:
        raise ValueError("model_des 为空字符串，必须提供 modelSpec JSON")
    try:
        parsed = json.loads(text)
    except Exception as exc:
        raise ValueError(f"model_des 不是合法 JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValueError("model_des 必须是 JSON 对象")
    return parsed


def validate_model_metadata(model_meta: dict):
    if not isinstance(model_meta, dict):
        raise ValueError("modelSpec 结构错误，必须是对象")

    required_fields = ["framework", "arch", "checkpointFormat", "inputChannels", "numClasses"]
    missing = []
    for key in required_fields:
        value = model_meta.get(key)
        if value is None:
            missing.append(key)
            continue
        if isinstance(value, str) and not value.strip():
            missing.append(key)
    if missing:
        raise ValueError(f"modelSpec 缺少必填字段: {', '.join(missing)}")

    model_meta["framework"] = _as_non_empty_str(model_meta.get("framework")).lower()
    model_meta["arch"] = _as_non_empty_str(model_meta.get("arch")).lower()
    model_meta["variant"] = _as_non_empty_str(model_meta.get("variant"))
    model_meta["backbone"] = _as_non_empty_str(model_meta.get("backbone"))
    model_meta["encoder"] = _as_non_empty_str(model_meta.get("encoder"))
    model_meta["checkpointFormat"] = _as_non_empty_str(model_meta.get("checkpointFormat")).lower()
    model_meta["weightFormat"] = _as_non_empty_str(model_meta.get("weightFormat")).lower()
    model_meta["versionTag"] = _as_non_empty_str(model_meta.get("versionTag"))
    model_meta["description"] = _as_non_empty_str(model_meta.get("description"))

    model_meta["inputChannels"] = _as_positive_int(model_meta.get("inputChannels"), "inputChannels")
    model_meta["numClasses"] = _as_positive_int(model_meta.get("numClasses"), "numClasses")

    constructor_args = model_meta.get("constructorArgs")
    if constructor_args is None:
        constructor_args = {}
    if not isinstance(constructor_args, dict):
        raise ValueError("modelSpec.constructorArgs 必须是 JSON 对象")
    model_meta["constructorArgs"] = constructor_args

    infer_params = model_meta.get("inferParams")
    if infer_params is None:
        infer_params = {}
    if not isinstance(infer_params, dict):
        raise ValueError("modelSpec.inferParams 必须是 JSON 对象")
    model_meta["inferParams"] = infer_params

    class_mapping = model_meta.get("classMapping")
    if class_mapping is None:
        class_mapping = {}
    if not isinstance(class_mapping, dict):
        raise ValueError("modelSpec.classMapping 必须是 JSON 对象")
    model_meta["classMapping"] = class_mapping

    supports = model_meta.get("supports")
    if supports is None:
        supports = {}
    if not isinstance(supports, dict):
        raise ValueError("modelSpec.supports 必须是 JSON 对象")
    model_meta["supports"] = {
        "preAnnotation": bool(supports.get("preAnnotation")),
        "qualityReference": bool(supports.get("qualityReference")),
        "batchInference": bool(supports.get("batchInference")),
    }

    return model_meta


def parse_model_metadata(model_info: dict):
    if not isinstance(model_info, dict):
        raise ValueError("model_info 格式错误")
    parsed = _parse_json_object(model_info.get("model_des"))
    return validate_model_metadata(parsed)


def infer_runtime_model_type(model_info: dict, model_meta: dict):
    arch = _as_non_empty_str(model_meta.get("arch")).lower()
    if arch in SUPPORTED_RUNTIME_TYPES:
        return arch

    framework = _as_non_empty_str(model_meta.get("framework")).lower()
    if framework == "ultralytics":
        return "yolo"

    model_path = _as_non_empty_str(model_info.get("path")).lower()
    if "yolo" in model_path:
        return "yolo"
    if "deeplab" in model_path:
        return "deeplab"
    if "segformer" in model_path:
        return "segformer"
    if "unet" in model_path:
        return "unet"
    if "fast_scnn" in model_path:
        return "fast_scnn"
    if "xgboost" in model_path:
        return "xgboost"
    return arch or "custom"
