"""
utils_prov.py
Python 后端溯源记录工具，与 Java 后端共用同一套 prov_* 数据库表。
所有写入操作在后台线程中执行，不阻塞主流程。
"""
import json
import uuid
import threading
from datetime import datetime
from typing import Optional

from utils_db import connect_db


# ── 内部辅助：直接操作 prov_* 表 ──────────────────────────────────────────────

def _get_or_create_agent(conn, external_id: str, agent_type: str) -> Optional[str]:
    """获取或创建 prov_agent 记录，返回 agent UUID。"""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM prov_agent WHERE external_id = %s AND agent_type = %s",
                (external_id, agent_type)
            )
            row = cur.fetchone()
            if row:
                return row[0]
            agent_id = str(uuid.uuid4())
            cur.execute(
                "INSERT INTO prov_agent (id, agent_name, agent_type, external_id, created_at) "
                "VALUES (%s, %s, %s, %s, %s)",
                (agent_id, f"Agent_{external_id}", agent_type, external_id, datetime.now())
            )
            conn.commit()
            return agent_id
    except Exception:
        try:
            # 并发冲突：重查
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM prov_agent WHERE external_id = %s AND agent_type = %s",
                    (external_id, agent_type)
                )
                row = cur.fetchone()
                return row[0] if row else None
        except Exception:
            return None


def _get_or_create_entity(conn, business_id: str, entity_type: str,
                           label: str, location: str = None,
                           attributes: dict = None) -> Optional[str]:
    """获取或创建 prov_entity 记录，返回 entity UUID。"""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM prov_entity WHERE business_id = %s AND entity_type = %s",
                (business_id, entity_type)
            )
            row = cur.fetchone()
            if row:
                return row[0]
            entity_id = str(uuid.uuid4())
            cur.execute(
                "INSERT INTO prov_entity (id, label, entity_type, business_id, location, attributes, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (entity_id, label, entity_type, business_id,
                 location, json.dumps(attributes or {}), datetime.now())
            )
            conn.commit()
            return entity_id
    except Exception:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM prov_entity WHERE business_id = %s AND entity_type = %s",
                    (business_id, entity_type)
                )
                row = cur.fetchone()
                return row[0] if row else None
        except Exception:
            return None


def _create_relation(conn, activity_id: str, entity_id: str, rel_type: str):
    """插入 prov_relation 记录（USED 或 GENERATED）。"""
    if not activity_id or not entity_id:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO prov_relation (activity_id, entity_id, rel_type, created_at) "
                "VALUES (%s, %s, %s, %s)",
                (activity_id, entity_id, rel_type, datetime.now())
            )
        conn.commit()
    except Exception:
        pass


def _record_activity_sync(act_type: str, agent_external_id: str, agent_type: str,
                           inputs: list, outputs: list, params: dict):
    """
    同步写入一条完整的 prov 记录（agent + activity + entity + relation）。
    inputs/outputs 格式：[{"business_id": ..., "entity_type": ..., "label": ..., "location": ...}, ...]
    """
    conn = connect_db()
    if conn is None:
        return
    try:
        # 1. Agent
        agent_id = _get_or_create_agent(conn, str(agent_external_id), agent_type)

        # 2. Activity
        activity_id = str(uuid.uuid4())
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO prov_activity (id, act_type, description, agent_id, start_time, parameters, status) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (activity_id, act_type, f"Performed {act_type}",
                 agent_id, datetime.now(), json.dumps(params or {}), "SUCCESS")
            )
        conn.commit()

        # 3. 输入实体 (USED)
        for ref in (inputs or []):
            eid = _get_or_create_entity(
                conn, ref["business_id"], ref["entity_type"],
                ref.get("label", ref["business_id"]),
                ref.get("location"), ref.get("attributes")
            )
            _create_relation(conn, activity_id, eid, "USED")

        # 4. 输出实体 (GENERATED)
        for ref in (outputs or []):
            eid = _get_or_create_entity(
                conn, ref["business_id"], ref["entity_type"],
                ref.get("label", ref["business_id"]),
                ref.get("location"), ref.get("attributes")
            )
            _create_relation(conn, activity_id, eid, "GENERATED")

    except Exception as e:
        print(f"[Prov] 记录失败 ({act_type}): {e}")
    finally:
        conn.close()


# ── 公开接口：异步记录，不阻塞主流程 ──────────────────────────────────────────

def record_prov_async(act_type: str, agent_id: str, agent_type: str,
                      inputs: list, outputs: list, params: dict):
    """
    在后台线程中异步写入 prov 记录，主流程零等待。
    """
    t = threading.Thread(
        target=_record_activity_sync,
        args=(act_type, agent_id, agent_type, inputs, outputs, params),
        daemon=True
    )
    t.start()


# ── 各业务节点的便捷封装 ──────────────────────────────────────────────────────

def prov_sam_annotate(task_id: str, user_id: str, prompt_type: str, poly_count: int):
    """SAM 交互标注（点/线/框）完成后记录。"""
    record_prov_async(
        act_type="SAM_ANNOTATE",
        agent_id=user_id,
        agent_type="PERSON",
        inputs=[{"business_id": task_id, "entity_type": "TASK", "label": f"任务#{task_id}"}],
        outputs=[{
            "business_id": f"{task_id}_{user_id}_{int(datetime.now().timestamp()*1000)}",
            "entity_type": "ANNOTATION_REVISION",
            "label": f"SAM标注结果"
        }],
        params={"promptType": prompt_type, "polyCount": poly_count, "source": "python_sam"}
    )


def prov_auto_building(task_id: str, user_id: str, det_count: int, poly_count: int):
    """全图建筑预标注完成后记录。"""
    record_prov_async(
        act_type="AUTO_ANNOTATE",
        agent_id="YOLO_SAM_PIPELINE",
        agent_type="SOFTWARE",
        inputs=[{"business_id": task_id, "entity_type": "TASK", "label": f"任务#{task_id}"}],
        outputs=[{
            "business_id": f"{task_id}_{user_id}_{int(datetime.now().timestamp()*1000)}",
            "entity_type": "ANNOTATION_REVISION",
            "label": f"全图预标注结果"
        }],
        params={"userId": user_id, "detectedBoxes": det_count,
                "generatedPolygons": poly_count, "source": "yolo_sam"}
    )


def prov_train(task_id: str, user_id: str, model_name: str, success: bool, message: str = ""):
    """模型训练完成后记录。"""
    record_prov_async(
        act_type="MODEL_TRAIN",
        agent_id=user_id,
        agent_type="PERSON",
        inputs=[{"business_id": task_id, "entity_type": "TASK", "label": f"任务#{task_id}"}],
        outputs=[{
            "business_id": f"model_{model_name}_{task_id}",
            "entity_type": "TRAINED_MODEL",
            "label": model_name
        }],
        params={"modelName": model_name, "success": success,
                "message": message, "source": "python_train"}
    )


def prov_inference(task_id: str, user_id: str, model_name: str, success: bool, message: str = ""):
    """模型推理完成后记录。agent 锁定为具体模型（SOFTWARE）。"""
    record_prov_async(
        act_type="MODEL_INFERENCE",
        agent_id=model_name or "unknown_model",  # 锁定为具体模型名
        agent_type="SOFTWARE",
        inputs=[
            {"business_id": task_id, "entity_type": "TASK", "label": f"任务#{task_id}"},
            {"business_id": f"model_{model_name}", "entity_type": "TRAINED_MODEL", "label": model_name}
        ],
        outputs=[{
            "business_id": f"{task_id}_{user_id}_{int(datetime.now().timestamp()*1000)}",
            "entity_type": "ANNOTATION_REVISION",
            "label": f"推理结果"
        }],
        params={"modelName": model_name, "operatorUserId": user_id,
                "success": success, "message": message, "source": "python_inference"}
    )


def prov_update_label(task_id: str, user_id: str):
    """更新样本标签后记录。agent 锁定为系统标签更新流程（SOFTWARE）。"""
    record_prov_async(
        act_type="UPDATE_LABEL",
        agent_id="label_updater",   # 系统自动流程，非人工操作
        agent_type="SOFTWARE",
        inputs=[{"business_id": task_id, "entity_type": "TASK", "label": f"任务#{task_id}"}],
        outputs=[{
            "business_id": f"{task_id}_label_{int(datetime.now().timestamp()*1000)}",
            "entity_type": "ANNOTATION_REVISION",
            "label": "样本标签更新"
        }],
        params={"triggerUserId": user_id, "source": "python_update_label"}
    )
