/*
import React, { useEffect, useRef } from 'react';
import G6 from '@antv/g6';

// 操作类型中英文映射
const ACTION_TRANSLATIONS = {
  'UPLOAD': '文件上传',
  'ANNOTATE': '数据标注',
  'AUDIT_PASS': '审核通过',
  'AUDIT_REJECT': '审核驳回',
  'DATASET_GENERATE': '数据集生成',
  'DATASET_EXPORT': '数据集导出',
  'PUBLISH_SERVICE': '发布服务',
  'DATASET_IMPORT': '数据集导入',
  'DATASET_CREATE': '数据集创建',
  'DATASET_UPDATE': '数据集更新',
  'DATASET_DELETE': '数据集删除',
  'MODEL_TRAIN': '模型训练',
  'MODEL_INFERENCE': '模型推理',
  'DATA_VALIDATION': '数据验证',
  'DATA_PREPROCESSING': '数据预处理',
  'QUALITY_CHECK': '质量检查',
  'AUDIT_LOG': '审计日志',
  'USER_OPERATION': '用户操作',
  'SYSTEM_OPERATION': '系统操作'
};

// PROV模型实体类型映射
const PROV_ENTITY_INFO = {
  'TASK': { label: '标注任务', provType: 'Entity', color: '#1890ff' },
  'RAW_IMAGE': { label: '原始影像', provType: 'Entity', color: '#52c41a' },
  'SAMPLE_SET': { label: '样本集', provType: 'Entity', color: '#722ed1' },
  'ANNOTATION_REVISION': { label: '标注版本', provType: 'Entity', color: '#fa8c16' },
  'AUDIT_REJECT': { label: '审核记录', provType: 'Entity', color: '#f5222d' },
  'DATASET': { label: '数据集', provType: 'Entity', color: '#1890ff' },
  'MODEL': { label: '模型', provType: 'Entity', color: '#52c41a' },
  'ANNOTATION': { label: '标注', provType: 'Entity', color: '#722ed1' },
  'IMAGE': { label: '图像文件', provType: 'Entity', color: '#13c2c2' },
  'LABEL': { label: '标签文件', provType: 'Entity', color: '#eb2f96' },
  'CONFIG': { label: '配置文件', provType: 'Entity', color: '#faad14' },
  'LOG': { label: '日志文件', provType: 'Entity', color: '#666' },
  'RESULT': { label: '结果文件', provType: 'Entity', color: '#2f54eb' }
};

// PROV模型代理类型映射
const PROV_AGENT_INFO = {
  'PERSON': { label: '用户', color: '#fa8c16', icon: '👤' },
  'SOFTWARE': { label: '软件系统', color: '#13c2c2', icon: '🤖' },
  'ORGANIZATION': { label: '组织机构', color: '#722ed1', icon: '🏢' }
};

const ProvenanceGraph = ({ data, onNodeClick, focusedNodeId }) => {
  const containerRef = useRef(null);
  const graphRef = useRef(null);

  useEffect(() => {
    if (!graphRef.current && containerRef.current) {
      graphRef.current = new G6.Graph({
        container: containerRef.current,
        width: containerRef.current.scrollWidth,
        height: 600,
        layout: {
          type: 'dagre', // 有向无环图布局，适合表现流程
          rankdir: 'TB', // 从上到下，更符合时间流向
          nodesep: 50,
          ranksep: 80,
          controlPoints: true,
        },
        defaultNode: {
          size: [180, 50],
          type: 'rect',
          style: {
            radius: 8,
            lineWidth: 2,
            shadowColor: 'rgba(0, 0, 0, 0.1)',
            shadowBlur: 6,
            shadowOffsetX: 2,
            shadowOffsetY: 2,
          },
          labelCfg: {
            style: {
              fontSize: 12,
              fontWeight: 500,
              fill: '#333'
            }
          },
        },
        defaultEdge: {
          type: 'polyline',
          style: {
            endArrow: {
              path: G6.Arrow.triangle(8, 10, 0),
              fill: '#666',
              stroke: '#666'
            },
            stroke: '#666',
            lineWidth: 2,
            radius: 10,
          },
          labelCfg: {
            style: {
              fontSize: 11,
              fill: '#666',
              background: {
                fill: '#fff',
                padding: [2, 4],
                radius: 3,
              }
            }
          }
        },
        modes: {
          default: ['drag-canvas', 'zoom-canvas', 'drag-node', 'click-select'],
        },
        nodeStateStyles: {
          selected: {
            stroke: '#1890ff',
            lineWidth: 3,
            shadowColor: 'rgba(24, 144, 255, 0.3)',
            shadowBlur: 10,
          },
          hover: {
            stroke: '#40a9ff',
            lineWidth: 2.5,
            shadowColor: 'rgba(64, 169, 255, 0.2)',
            shadowBlur: 8,
          }
        },
        edgeStateStyles: {
          selected: {
            stroke: '#1890ff',
            lineWidth: 3,
          }
        }
      });

      graphRef.current.on('node:click', (evt) => {
        const { item } = evt;
        const model = item.getModel();

        // 清除之前的选中状态
        graphRef.current.getNodes().forEach(node => {
          graphRef.current.clearItemStates(node);
        });

        // 设置当前节点为选中状态
        graphRef.current.setItemState(item, 'selected', true);

        onNodeClick(model);
      });

      graphRef.current.on('node:mouseenter', (evt) => {
        const { item } = evt;
        graphRef.current.setItemState(item, 'hover', true);
      });

      graphRef.current.on('node:mouseleave', (evt) => {
        const { item } = evt;
        graphRef.current.setItemState(item, 'hover', false);
      });
    }

    if (data && graphRef.current) {
      const processedData = processData(data);
      graphRef.current.data(processedData);
      graphRef.current.render();
      graphRef.current.fitView(20);
    }
  }, [data]);

  // 将后端实体/活动转换为 G6 节点
  const processData = (raw) => {
    const nodes = [];
    const edges = [];

    // 处理活动 (Activities) - PROV模型中的Activity
    raw.activities?.forEach(act => {
      const actionText = ACTION_TRANSLATIONS[act.actType] || act.actType;

      // 查找对应的代理信息
      const agent = raw.agents?.find(a => a.id === act.agentId);
      const agentInfo = agent ? PROV_AGENT_INFO[agent.agentType] || { label: '未知', icon: '❓' } : { label: '系统', icon: '🤖' };
      const agentName = agent ? agent.agentName : (act.agentId || '系统');

      nodes.push({
        id: act.id,
        label: `${actionText}\n${agentInfo.icon} ${agentName}`,
        originType: 'ACTIVITY',
        rawData: act,
        agentData: agent,
        style: {
          fill: '#fff7e6',
          stroke: '#ffa940',
          cursor: 'pointer'
        },
        provInfo: {
          type: 'Activity',
          description: 'PROV模型中的活动实体，表示数据处理过程'
        }
      });
    });

    // 处理实体 (Entities) - PROV模型中的Entity
    raw.entities?.forEach(ent => {
      const entityInfo = PROV_ENTITY_INFO[ent.entityType] || {
        label: ent.entityType,
        provType: 'Entity',
        color: '#1890ff'
      };

      nodes.push({
        id: ent.id,
        label: `${entityInfo.label}\n${ent.label || ent.businessId || ent.id.substring(0, 8)}`,
        originType: 'ENTITY',
        rawData: ent,
        type: 'ellipse', // 椭圆代表实体
        size: [160, 60],
        style: {
          fill: '#e6f7ff',
          stroke: entityInfo.color,
          cursor: 'pointer'
        },
        provInfo: {
          type: entityInfo.provType,
          description: `PROV模型中的${entityInfo.provType === 'Agent' ? '代理' : '实体'}，表示${entityInfo.label}`
        }
      });
    });

    // 处理关系 (Relations) - PROV模型中的关系
    raw.relations?.forEach(rel => {
      if (rel.relType === 'USED') {
        // 实体 -> 活动 (输入) - PROV中的used关系
        edges.push({
          source: rel.entityId,
          target: rel.activityId,
          label: '被使用',
          style: { stroke: '#52c41a', lineWidth: 2 },
          provInfo: 'used关系：活动使用了实体'
        });
      } else if (rel.relType === 'GENERATED') {
        // 活动 -> 实体 (生成) - PROV中的wasGeneratedBy关系
        edges.push({
          source: rel.activityId,
          target: rel.entityId,
          label: '生成',
          style: { stroke: '#1890ff', lineWidth: 2 },
          provInfo: 'wasGeneratedBy关系：实体由活动生成'
        });
      } else if (rel.relType === 'DERIVED') {
        // 实体 -> 实体 (派生) - PROV中的wasDerivedFrom关系
        edges.push({
          source: rel.sourceEntityId,
          target: rel.targetEntityId,
          label: '派生',
          style: { stroke: '#722ed1', lineWidth: 2, lineDash: [5, 5] },
          provInfo: 'wasDerivedFrom关系：实体从另一个实体派生'
        });
      }
    });

    return { nodes, edges };
  };

  return (
    <div className="provenance-graph">
      <div ref={containerRef} />

      {/!* 图例 *!/}
      <div className="graph-legend">
        <div className="legend-item">
          <div className="legend-icon activity"></div>
          <span className="legend-text">活动 (Activity)</span>
        </div>
        <div className="legend-item">
          <div className="legend-icon entity"></div>
          <span className="legend-text">实体 (Entity)</span>
        </div>
      </div>

      {/!* PROV模型说明 *!/}
      <div className="prov-model-info">
        基于PROV-DM数据模型<br/>
        蓝色椭圆：实体(Entity)<br/>
        橙色矩形：活动(Activity)<br/>
        绿色线：使用关系(used)<br/>
        蓝色线：生成关系(wasGeneratedBy)
      </div>
    </div>
  );
};

export default ProvenanceGraph;*/


import React, { useEffect, useRef, useCallback } from 'react';
import G6 from '@antv/g6';

// 操作类型中英文映射
const ACTION_TRANSLATIONS = {
  'UPLOAD': '文件上传',
  'ANNOTATE': '数据标注',
  'AUDIT_PASS': '审核通过',
  'AUDIT_REJECT': '审核驳回',
  'DATASET_GENERATE': '数据集生成',
  'DATASET_EXPORT': '数据集导出',
  'PUBLISH_SERVICE': '发布服务',
  'DATASET_IMPORT': '数据集导入',
  'DATASET_CREATE': '数据集创建',
  'DATASET_UPDATE': '数据集更新',
  'DATASET_DELETE': '数据集删除',
  'MODEL_TRAIN': '模型训练',
  'MODEL_INFERENCE': '模型推理',
  'DATA_VALIDATION': '数据验证',
  'DATA_PREPROCESSING': '数据预处理',
  'QUALITY_CHECK': '质量检查',
  'AUDIT_LOG': '审计日志',
  'USER_OPERATION': '用户操作',
  'SYSTEM_OPERATION': '系统操作'
};

// PROV模型实体类型映射
const PROV_ENTITY_INFO = {
  'TASK': { label: '标注任务', provType: 'Entity', color: '#1890ff' },
  'RAW_IMAGE': { label: '原始影像', provType: 'Entity', color: '#52c41a' },
  'SAMPLE_SET': { label: '样本集', provType: 'Entity', color: '#722ed1' },
  'ANNOTATION_REVISION': { label: '标注版本', provType: 'Entity', color: '#fa8c16' },
  'AUDIT_REJECT': { label: '审核记录', provType: 'Entity', color: '#f5222d' },
  'DATASET': { label: '数据集', provType: 'Entity', color: '#1890ff' },
  'MODEL': { label: '模型', provType: 'Entity', color: '#52c41a' },
  'ANNOTATION': { label: '标注', provType: 'Entity', color: '#722ed1' },
  'IMAGE': { label: '图像文件', provType: 'Entity', color: '#13c2c2' },
  'LABEL': { label: '标签文件', provType: 'Entity', color: '#eb2f96' },
  'CONFIG': { label: '配置文件', provType: 'Entity', color: '#faad14' },
  'LOG': { label: '日志文件', provType: 'Entity', color: '#666' },
  'RESULT': { label: '结果文件', provType: 'Entity', color: '#2f54eb' }
};

// PROV模型代理类型映射
const PROV_AGENT_INFO = {
  'PERSON': { label: '用户', color: '#fa8c16', icon: '👤' },
  'SOFTWARE': { label: '软件系统', color: '#13c2c2', icon: '🤖' },
  'ORGANIZATION': { label: '组织机构', color: '#722ed1', icon: '🏢' }
};

const ProvenanceGraph = ({ data, onNodeClick, focusedNodeId }) => {
  const containerRef = useRef(null);
  const graphRef = useRef(null);

  // 缓存外部函数，避免重复触发重渲染
  const onNodeClickRef = useRef(onNodeClick);
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);

  const applyFocusedNode = useCallback((nodeId) => {
    if (!graphRef.current || !nodeId) {
      return;
    }
    const graph = graphRef.current;
    const targetNode = graph.findById(nodeId);
    if (!targetNode) {
      return;
    }
    graph.getNodes().forEach((node) => {
      graph.clearItemStates(node);
    });
    graph.setItemState(targetNode, 'selected', true);
    graph.focusItem(targetNode, true, {
      easing: 'easeCubic',
      duration: 500,
    });
  }, []);

// 将后端实体/活动转换为 G6 节点，加入"幽灵节点自动补全"机制
  const processData = useCallback((raw) => {
    const nodes = [];
    const edges = [];
    const validNodeIds = new Set();

    // 1. 处理活动 (Activities)
    raw.activities?.forEach(act => {
      if (!act.id) return;
      validNodeIds.add(act.id);

      const actionText = ACTION_TRANSLATIONS[act.actType] || act.actType;
      const agent = raw.agents?.find(a => a.id === act.agentId);
      const agentInfo = agent ? PROV_AGENT_INFO[agent.agentType] || { label: '未知', icon: '❓' } : { label: '系统', icon: '🤖' };
      const agentName = agent ? agent.agentName : (act.agentId || '系统');

      nodes.push({
        id: act.id,
        label: `${actionText}\n${agentInfo.icon} ${agentName}`,
        originType: 'ACTIVITY',
        rawData: act,
        style: { fill: '#fff7e6', stroke: '#ffa940', cursor: 'pointer' },
      });
    });

    // 2. 处理实体 (Entities)
    raw.entities?.forEach(ent => {
      if (!ent.id) return;
      validNodeIds.add(ent.id);

      const entityInfo = PROV_ENTITY_INFO[ent.entityType] || { label: ent.entityType, color: '#1890ff' };
      nodes.push({
        id: ent.id,
        label: `${entityInfo.label}\n${ent.label || ent.businessId || ent.id.substring(0, 8)}`,
        originType: 'ENTITY',
        rawData: ent,
        type: 'ellipse',
        size: [160, 60],
        style: { fill: '#e6f7ff', stroke: entityInfo.color, cursor: 'pointer' },
      });
    });

    // 3. 处理关系，并动态补全缺失的节点 (Relations)
    raw.relations?.forEach(rel => {
      let sourceId, targetId, label, style;

      if (rel.relType === 'USED') {
        sourceId = rel.entityId;
        targetId = rel.activityId;
        label = '被使用';
        style = { stroke: '#52c41a', lineWidth: 2 };
      } else if (rel.relType === 'GENERATED') {
        sourceId = rel.activityId;
        targetId = rel.entityId;
        label = '生成';
        style = { stroke: '#1890ff', lineWidth: 2 };
      } else if (rel.relType === 'DERIVED') {
        sourceId = rel.sourceEntityId;
        targetId = rel.targetEntityId;
        label = '派生';
        style = { stroke: '#722ed1', lineWidth: 2, lineDash: [5, 5] };
      }

      if (sourceId && targetId) {
        // 💥 魔法机制：如果起点或终点不在 validNodeIds 中，自动创建一个幽灵节点！
        [sourceId, targetId].forEach(nodeId => {
          if (!validNodeIds.has(nodeId)) {
            console.warn(`[前端数据修补] 后端遗漏了节点数据，已自动生成幽灵节点: ${nodeId}`);
            validNodeIds.add(nodeId);
            nodes.push({
              id: nodeId,
              label: `未知数据实体\n(后端未返回详情)`,
              type: 'ellipse',
              size: [160, 60],
              style: {
                fill: '#f5f5f5',      // 灰色背景
                stroke: '#d9d9d9',    // 灰色边框
                lineDash: [4, 4],     // 虚线边框，表示数据不完整
                cursor: 'not-allowed'
              },
            });
          }
        });

        // 此时由于已经做了补全，必然能找到 source 和 target，直接画线
        edges.push({ source: sourceId, target: targetId, label, style });
      }
    });

    return { nodes, edges };
  }, []);

  // 挂载时初始化图表 (彻底解决拖影，绝对只执行一次)
  useEffect(() => {
    const containerEl = containerRef.current;
    if (!graphRef.current && containerEl) {

      // 物理清空 DOM 残留，杜绝拖影
      containerEl.innerHTML = '';
      const containerWidth = containerEl.scrollWidth || containerEl.clientWidth || 800;

      graphRef.current = new G6.Graph({
        container: containerEl,
        width: containerWidth,
        height: 600,
        fitView: true,
        fitViewPadding: [20, 20, 20, 20],
        fitCenter: true,
        layout: {
          type: 'dagre', // 有向无环图布局，适合表现流程
          rankdir: 'TB', // 从上到下，更符合时间流向
          nodesep: 50,
          ranksep: 80,
          controlPoints: true,
        },
        defaultNode: {
          size: [180, 50],
          type: 'rect',
          style: {
            radius: 8,
            lineWidth: 2,
            shadowColor: 'rgba(0, 0, 0, 0.1)',
            shadowBlur: 6,
            shadowOffsetX: 2,
            shadowOffsetY: 2,
          },
          labelCfg: {
            style: {
              fontSize: 12,
              fontWeight: 500,
              fill: '#333'
            }
          },
        },
        defaultEdge: {
          type: 'polyline',
          style: {
            endArrow: {
              path: G6.Arrow.triangle(8, 10, 0),
              fill: '#666',
              stroke: '#666'
            },
            stroke: '#666',
            lineWidth: 2,
            radius: 10,
          },
          labelCfg: {
            style: {
              fontSize: 11,
              fill: '#666',
              background: {
                fill: '#fff',
                padding: [2, 4],
                radius: 3,
              }
            }
          }
        },
        modes: {
          default: ['drag-canvas', 'zoom-canvas', 'drag-node', 'click-select'],
        },
        nodeStateStyles: {
          selected: {
            stroke: '#1890ff',
            lineWidth: 3,
            shadowColor: 'rgba(24, 144, 255, 0.3)',
            shadowBlur: 10,
          },
          hover: {
            stroke: '#40a9ff',
            lineWidth: 2.5,
            shadowColor: 'rgba(64, 169, 255, 0.2)',
            shadowBlur: 8,
          }
        },
        edgeStateStyles: {
          selected: {
            stroke: '#1890ff',
            lineWidth: 3,
          }
        }
      });

      // 💥 监听布局完成后，再执行画布居中，防止坐标还没算完就居中导致偏移
      graphRef.current.on('afterlayout', () => {
        if (graphRef.current) {
          graphRef.current.fitView(20);
          graphRef.current.fitCenter();
        }
      });

      graphRef.current.on('node:click', (evt) => {
        const { item } = evt;
        const model = item.getModel();

        // 清除之前的选中状态
        graphRef.current.getNodes().forEach(node => {
          graphRef.current.clearItemStates(node);
        });

        // 设置当前节点为选中状态
        graphRef.current.setItemState(item, 'selected', true);

        if (onNodeClickRef.current) {
          onNodeClickRef.current(model);
        }
      });

      graphRef.current.on('node:mouseenter', (evt) => {
        const { item } = evt;
        graphRef.current.setItemState(item, 'hover', true);
      });

      graphRef.current.on('node:mouseleave', (evt) => {
        const { item } = evt;
        graphRef.current.setItemState(item, 'hover', false);
      });
    }

    // 销毁机制
    return () => {
      if (graphRef.current) {
        graphRef.current.destroy();
        graphRef.current = null;
      }
      if (containerEl) {
        containerEl.innerHTML = '';
      }
    };
  }, []); // <-- 依赖项为空，保证绝不多次初始化

  // 监听数据更新，不重置实例，而是用 changeData
  useEffect(() => {
    if (data && graphRef.current) {
      const processedData = processData(data);
      if (processedData.nodes.length > 0) {
        // 使用 changeData，由引擎内部处理更新和触发布局
        graphRef.current.changeData(processedData);
      } else {
        graphRef.current.clear();
      }
    }
  }, [data, processData]);

  useEffect(() => {
    if (!focusedNodeId || !graphRef.current) {
      return;
    }
    const timer = setTimeout(() => {
      applyFocusedNode(focusedNodeId);
    }, 120);
    return () => clearTimeout(timer);
  }, [applyFocusedNode, focusedNodeId]);

  return (
    <div className="provenance-graph">
      <div ref={containerRef} />

      {/* 图例 */}
      <div className="graph-legend">
        <div className="legend-item">
          <div className="legend-icon activity" />
          <span className="legend-text">活动 (Activity)</span>
        </div>
        <div className="legend-item">
          <div className="legend-icon entity" />
          <span className="legend-text">实体 (Entity)</span>
        </div>
      </div>

      {/* PROV模型说明 */}
      <div className="prov-model-info">
        基于PROV-DM数据模型<br/>
        蓝色椭圆：实体(Entity)<br/>
        橙色矩形：活动(Activity)<br/>
        绿色线：使用关系(used)<br/>
        蓝色线：生成关系(wasGeneratedBy)
      </div>
    </div>
  );
};

export default ProvenanceGraph;
