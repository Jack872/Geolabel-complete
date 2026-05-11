from typing import Any, Callable, Dict, Tuple

from models.light_unet import LightUNet
from models.unet import UNet
from models.fast_scnn import FastSCNN
from models.deeplab import DeepLabV3Plus


def _to_int(value: Any, default_value: int) -> int:
    try:
        return int(value)
    except Exception:
        return int(default_value)


def _normalize_framework(framework: Any) -> str:
    raw = str(framework or "").strip().lower()
    alias = {
        "torch": "native",
        "pytorch": "native",
        "native": "native",
        "transformers": "transformers",
        "huggingface": "transformers",
        "huggingface_transformers": "transformers",
        "hf": "transformers",
        "hf_transformers": "transformers",
        "ultralytics": "yolo",
        "yolo": "yolo",
        "segmentation_models_pytorch": "smp",
        "smp": "smp",
        "sklearn": "sklearn",
    }
    return alias.get(raw, raw)


def _normalize_arch(arch: Any) -> str:
    raw = str(arch or "").strip().lower()
    if raw.startswith("yolo"):
        return "yolo"
    if raw.startswith("segformer"):
        return "segformer"
    alias = {
        "lightunet": "light_unet",
        "light_unet": "light_unet",
        "fastscnn": "fast_scnn",
        "fast_scnn": "fast_scnn",
        "deeplab": "deeplabv3plus",
        "deeplabv3+": "deeplabv3plus",
        "deeplab_v3_plus": "deeplabv3plus",
        "deeplabv3plus": "deeplabv3plus",
        "segformerforsemanticsegmentation": "segformer",
        "unet++": "unetplusplus",
        "unetpp": "unetplusplus",
        "unetplusplus": "unetplusplus",
        "yolov8": "yolo",
        "yolov11": "yolo",
    }
    return alias.get(raw, raw)


def _get_constructor_args(model_meta: Dict[str, Any]) -> Dict[str, Any]:
    ctor = model_meta.get("constructorArgs")
    if isinstance(ctor, dict):
        return ctor
    return {}


def _build_native_unet(model_meta: Dict[str, Any], device):
    model = UNet(
        in_channels=_to_int(model_meta.get("inputChannels"), 3),
        num_classes=_to_int(model_meta.get("numClasses"), 2),
    ).to(device)
    return model, "unet", True


def _build_native_light_unet(model_meta: Dict[str, Any], device):
    model = LightUNet(
        in_channels=_to_int(model_meta.get("inputChannels"), 3),
        num_classes=_to_int(model_meta.get("numClasses"), 2),
    ).to(device)
    return model, "light_unet", True


def _build_native_fast_scnn(model_meta: Dict[str, Any], device):
    model = FastSCNN(
        in_channels=_to_int(model_meta.get("inputChannels"), 3),
        num_classes=_to_int(model_meta.get("numClasses"), 2),
    ).to(device)
    return model, "fast_scnn", True


def _build_native_deeplabv3plus(model_meta: Dict[str, Any], device):
    ctor = _get_constructor_args(model_meta)
    backbone_name = (
        ctor.get("backbone_name")
        or model_meta.get("backbone")
        or model_meta.get("encoder")
        or "mobilenet_v3_large"
    )
    pretrained = bool(ctor.get("pretrained", True))
    aux_loss_enabled_for_wrapper = bool(ctor.get("aux_loss_enabled_for_wrapper", False))
    model = DeepLabV3Plus(
        in_channels=_to_int(model_meta.get("inputChannels"), 3),
        num_classes=_to_int(model_meta.get("numClasses"), 2),
        backbone_name=backbone_name,
        pretrained=pretrained,
        aux_loss_enabled_for_wrapper=aux_loss_enabled_for_wrapper,
    ).to(device)
    return model, "deeplab", True


def _build_smp_unet(model_meta: Dict[str, Any], device):
    try:
        import segmentation_models_pytorch as smp
    except Exception as exc:
        raise RuntimeError("unsupported: smp/unet 需要安装 segmentation_models_pytorch") from exc
    ctor = _get_constructor_args(model_meta)
    encoder_name = ctor.get("encoder_name") or model_meta.get("encoder") or model_meta.get("backbone") or "resnet34"
    encoder_weights = ctor.get("encoder_weights", None)
    model = smp.Unet(
        encoder_name=encoder_name,
        encoder_weights=encoder_weights,
        in_channels=_to_int(model_meta.get("inputChannels"), 3),
        classes=_to_int(model_meta.get("numClasses"), 2),
    ).to(device)
    return model, "unet", True


def _build_smp_unetplusplus(model_meta: Dict[str, Any], device):
    try:
        import segmentation_models_pytorch as smp
    except Exception as exc:
        raise RuntimeError("unsupported: smp/unetplusplus 需要安装 segmentation_models_pytorch") from exc
    ctor = _get_constructor_args(model_meta)
    encoder_name = ctor.get("encoder_name") or model_meta.get("encoder") or model_meta.get("backbone") or "resnet34"
    encoder_weights = ctor.get("encoder_weights", None)
    model = smp.UnetPlusPlus(
        encoder_name=encoder_name,
        encoder_weights=encoder_weights,
        in_channels=_to_int(model_meta.get("inputChannels"), 3),
        classes=_to_int(model_meta.get("numClasses"), 2),
    ).to(device)
    return model, "unet", True


def _build_transformers_segformer(model_meta: Dict[str, Any], device):
    try:
        from transformers import SegformerConfig, SegformerForSemanticSegmentation
    except Exception as exc:
        raise RuntimeError("unsupported: transformers/segformer 需要安装 transformers") from exc

    ctor = _get_constructor_args(model_meta)
    num_labels = _to_int(model_meta.get("numClasses"), 2)
    num_channels = _to_int(model_meta.get("inputChannels"), 3)

    id2label = {idx: str(idx) for idx in range(num_labels)}
    label2id = {str(idx): idx for idx in range(num_labels)}
    pretrained_name = ctor.get("pretrained_model_name") or ctor.get("pretrainedModelName")

    if pretrained_name:
        model = SegformerForSemanticSegmentation.from_pretrained(
            pretrained_name,
            num_labels=num_labels,
            num_channels=num_channels,
            id2label=id2label,
            label2id=label2id,
            ignore_mismatched_sizes=True,
        )
    else:
        config_kwargs = {}
        for key in (
            "hidden_sizes",
            "depths",
            "sr_ratios",
            "patch_sizes",
            "strides",
            "num_attention_heads",
            "drop_path_rate",
            "hidden_dropout_prob",
            "attention_probs_dropout_prob",
            "classifier_dropout_prob",
        ):
            if key in ctor and ctor.get(key) is not None:
                config_kwargs[key] = ctor.get(key)
        config = SegformerConfig(
            num_labels=num_labels,
            num_channels=num_channels,
            id2label=id2label,
            label2id=label2id,
            **config_kwargs,
        )
        model = SegformerForSemanticSegmentation(config)

    model = model.to(device)
    return model, "segformer", True


def _build_yolo(model_meta: Dict[str, Any], _device):
    model_path = model_meta.get("modelPath") or model_meta.get("path")
    if not model_path:
        raise RuntimeError("构造 yolo 模型失败: 缺少 modelPath")
    from ultralytics import YOLO
    model = YOLO(model_path)
    return model, "yolo", False


def _build_xgboost(model_meta: Dict[str, Any], _device):
    model_path = model_meta.get("modelPath") or model_meta.get("path")
    if not model_path:
        raise RuntimeError("构造 xgboost 模型失败: 缺少 modelPath")
    import joblib
    model = joblib.load(model_path)
    return model, "xgboost", False


MODEL_BUILDERS: Dict[Tuple[str, str], Callable[[Dict[str, Any], Any], Tuple[Any, str, bool]]] = {
    ("native", "unet"): _build_native_unet,
    ("native", "light_unet"): _build_native_light_unet,
    ("native", "fast_scnn"): _build_native_fast_scnn,
    ("native", "deeplabv3plus"): _build_native_deeplabv3plus,
    ("smp", "unet"): _build_smp_unet,
    ("smp", "unetplusplus"): _build_smp_unetplusplus,
    ("transformers", "segformer"): _build_transformers_segformer,
    ("yolo", "yolo"): _build_yolo,
    ("sklearn", "xgboost"): _build_xgboost,
}


def build_model_from_spec(model_meta: Dict[str, Any], device):
    framework_raw = model_meta.get("framework")
    arch_raw = model_meta.get("arch")
    model_name = model_meta.get("modelName") or model_meta.get("model_name") or ""
    framework = _normalize_framework(framework_raw)
    arch = _normalize_arch(arch_raw)
    builder = MODEL_BUILDERS.get((framework, arch))
    if builder is None:
        raise RuntimeError(
            f"unsupported model builder: framework={framework_raw}, arch={arch_raw}, "
            f"normalized=({framework},{arch}), model_name={model_name}"
        )
    model, runtime_type, requires_weight_load = builder(model_meta, device)
    return {
        "model": model,
        "runtime_type": runtime_type,
        "requires_weight_load": bool(requires_weight_load),
        "framework": framework,
        "arch": arch,
        "builder_key": f"{framework}:{arch}",
    }
