import {
  CheckCircleOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  ExpandOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-layout';
import { ProTable, TableDropdown } from '@ant-design/pro-table';
import { useModel, history } from 'umi';
console.log('umi models:', Object.keys(window.g_umi?.models || {}));
import { Button, message, Popconfirm, Select, Tag } from 'antd';
import { useRef, useState, useEffect } from 'react';
import {
  reqGetTaskList,
  reqNewTask,
  reqDeleteTask,
  reqEditTask,
  reqGetSelectableImagesByName,
  reqPublishLocalTask,
  reqPublishTaskBySet,
} from '@/services/taskManage/api.js';
// 引入封装的跳转方法
import { Encrypt } from '@/utils/utils.js';
import AuditReportModal from './components/AuditReportModal.jsx';
import DatasetConfigModal from './components/DatasetConfigModal'; // 引入新组件
// 引入封装模态框表单
import CollectionCreateForm from './components/index.jsx';
import { getAuditInfo } from '@/services/audit/api.js';
import {reqGenerateMergedDataset } from '@/services/sampleSet/api'
// #region

const TaskManage = () => {
  const actionRef = useRef();
  // 控制模态框显示影藏
  const [visible, setVisible] = useState(false);
  const [defaultValue, setDefaultValue] = useState({});
  // 获取影像集分组信息
  const { getServerListBySetName } = useModel('serverModel');
  const { userList, getUserList } = useModel('userModel');
  const { getTypeInfo, typeList } = useModel('typeModel');
  // 管理审核报告 Modal 的状态
  const [isReportModalVisible, setIsReportModalVisible] = useState(false);
  const [auditReportData, setAuditReportData] = useState(null);
  // 为了更好的用户体验，我们记录当前正在加载报告的任务ID
  const [loadingTaskId, setLoadingTaskId] = useState(null);
  const [selectableImageOptions, setSelectableImageOptions] = useState([]);

  // 获取当前用户信息
  const { initialState } = useModel('@@initialState');
  const { currentState } = initialState || {};
  const isAdmin = currentState?.isAdmin === 1;
  const currentUserScore = currentState?.score || 0; // 直接从currentState获取积分


  // 新增状态：控制数据集生成 Modal
  const [datasetModalVisible, setDatasetModalVisible] = useState(false);
  // 新增状态：存储选中的行
  const [selectedRowsState, setSelectedRows] = useState([]);

  const getTaskStatusMeta = (record) => {
    switch (record?.status) {
      case 0:
        return { text: '审核中', color: 'processing', icon: <ClockCircleOutlined /> };
      case 1:
        return { text: '审核通过', color: 'success', icon: <CheckCircleOutlined /> };
      case 2:
        return { text: '审核未通过', color: 'error', icon: <CloseCircleOutlined /> };
      case 3:
        if (record?.auditfeedback) {
          return { text: '审核退回', color: 'orange', icon: <CloseCircleOutlined /> };
        }
        return { text: '未提交', color: '#BDBDBD', icon: <MinusCircleOutlined /> };
      default:
        return { text: '未提交', color: '#BDBDBD', icon: <MinusCircleOutlined /> };
    }
  };

  // 处理生成请求
  const handleGenerateDataset = async (values) => {
    const hide = message.loading('正在后台生成数据集，请稍候...', 0);
    try {
      // 提取选中的 taskIds
      const taskIds = selectedRowsState.map(row => row.taskid);

      const params = {
        // 1. 基础参数
        taskIds: taskIds,
        datasetName: values.datasetName,
        description: values.description,
        username: initialState.currentState.currentUser,

        // 2. 新增裁剪参数 (与后端 Map key 对应)
        targetSize: values.targetSize,   // Integer
        expandRatio: values.expandRatio, // Double
        forceSquare: values.forceSquare, // Boolean
      };

      // 调用后端新接口
      const result = await reqGenerateMergedDataset(params);

      hide();
      if (result.code === 200) {
        message.success('样本集生成任务已提交，请去样本中心查看进度！');
        setDatasetModalVisible(false);
        setSelectedRows([]); // 清空选择
        if (actionRef.current) {
          actionRef.current.clearSelected(); // 清除 UI 选中状态
        }
      } else {
        message.error(result.message || '生成失败');
      }
    } catch (error) {
      hide();
      message.error('请求发生错误');
      console.error(error);
    }
  };

  useEffect(() => {

  }, [currentState, currentUserScore]);

  const loadSelectableImageOptions = async () => {
    try {
      const result = await reqGetSelectableImagesByName();
      if (result?.code === 200 && Array.isArray(result.data)) {
        setSelectableImageOptions(result.data);
      } else {
        setSelectableImageOptions([]);
        message.warning(result?.message || '获取影像名称列表失败');
      }
    } catch (error) {
      setSelectableImageOptions([]);
      message.error('获取影像名称列表失败');
    }
  };

  const buildAssignmentRequestValues = (values, targetUserType) => {
    if (isAdmin && targetUserType === 'specificTeamUsers') {
      const specificUserAssignments = values.specificUserAssignments || [];
      const userArr = [];

      specificUserAssignments.forEach((assignment) => {
        const username = assignment.username;
        const typeArr = assignment.typeArr || [];
        const typeIdArr = typeArr.map((typeItem) => {
          const numberValue = Number(typeItem);
          if (!Number.isNaN(numberValue)) {
            return typeItem;
          }
          const typeObj = typeList.find((obj) => obj.typeName === typeItem);
          return typeObj ? typeObj.typeId : typeItem;
        });
        userArr.push(`${username},${typeIdArr.join(',')}`);
      });

      return {
        userArr,
        specificUserAssignments,
      };
    }

    return {
      selectedSampleTypes: values.selectedSampleTypes || values.uniformSampleTypes || [],
    };
  };

  const buildTaskRequestValues = ({
    values,
    currentTaskName,
    daterange,
    taskid,
    type,
    targetUserType,
    score,
    mapserver,
    localImagePath,
  }) => {
    const requestValues = {
      daterange: daterange.map((item) => item.format('YYYY-MM-DD')),
      taskname: currentTaskName,
      type,
      targetUserType: isAdmin ? targetUserType : 'allNonAdminUsers',
      ...buildAssignmentRequestValues(values, targetUserType),
    };
    if (values.taskTypeAttributes !== undefined) {
      requestValues.taskTypeAttributes = values.taskTypeAttributes;
    }

    const isNonTeamTaskLogic =
      targetUserType === 'allNonAdminUsers' || targetUserType === 'allNonTeamUsers';
    if (isNonTeamTaskLogic && score > 0) {
      requestValues.score = score;
    }
    if (taskid) {
      requestValues.taskid = taskid;
    }
    if (mapserver !== undefined) {
      requestValues.mapserver = mapserver;
    }
    if (localImagePath !== undefined) {
      requestValues.localImagePath = localImagePath;
    }

    return requestValues;
  };

  // 新建参数收集
  const onCreate = async (values) => {
    let { daterange, taskid, taskname, type, mapserver, targetUserType, score, mapSelectMode } = values;
    const isNonTeamTaskLogic =
      targetUserType === 'allNonAdminUsers' || targetUserType === 'allNonTeamUsers';

    // 本地图片任务（无坐标系）走独立流程
    if (mapSelectMode === 'local') {
      const localFileIds = (values.localFileIds || []).filter(Boolean);
      const localImagePaths = (values.localImagePaths || []).filter(p => p && p.trim());
      if (localFileIds.length === 0 && localImagePaths.length === 0) {
        message.error('请至少选择一个已上传影像，或输入开发模式路径');
        return;
      }
      const selectableImageMap = new Map(
        selectableImageOptions.map((item) => [String(item.fileId), item]),
      );
      const hide = message.loading(`正在创建多影像本地任务...`);
      try {
        const result = await reqPublishLocalTask({
          ...buildTaskRequestValues({
            values,
            currentTaskName: taskname,
            daterange,
            type,
            targetUserType,
            score: typeof score === 'number' ? score : Number(score) || 0,
          }),
          taskItems: localImagePaths.map((localImagePath) => ({
            source: 'local',
            localImagePath: localImagePath.trim(),
            itemName: localImagePath.trim().split(/[\\/]/).pop(),
          })).concat(localFileIds.map((fileId) => {
            const option = selectableImageMap.get(String(fileId));
            return {
              source: 'local',
              fileId,
              itemName: option?.name || option?.fileName || `file-${fileId}`,
            };
          })),
        });
        hide();
        if (result.code === 200) {
          message.success(`成功创建 1 个多影像任务（${localImagePaths.length} 张）`);
          setVisible(false);
          setDefaultValue({});
          actionRef.current.reload();
        } else {
          message.error(result.message || '创建本地任务失败');
        }
      } catch (error) {
        hide();
        message.error('创建本地任务失败！');
      }
      return;
    }

    // 按影像集批量创建（自动识别 service/local）
    if (mapSelectMode === 'bySetName') {
      const setNames = values.setNames || [];
      if (setNames.length === 0) {
        message.error('请至少选择一个影像集');
        return;
      }

      // 确保score是数字
      score = typeof score === 'number' ? score : Number(score) || 0;
      const hide = message.loading(`正在按影像集创建任务...`);
      try {
        const map = daterange.map(item => item.format('YYYY-MM-DD'));
        const requestValues = {
          daterange: map,
          taskname,
          type,
          setNames,
          score,
          targetUserType: isAdmin ? targetUserType : 'allNonAdminUsers',
        };
        if (values.taskTypeAttributes !== undefined) {
          requestValues.taskTypeAttributes = values.taskTypeAttributes;
        }

        if (isAdmin && targetUserType === "specificTeamUsers") {
          requestValues.specificUserAssignments = values.specificUserAssignments || [];
        } else {
          requestValues.selectedSampleTypes = values.selectedSampleTypes || values.uniformSampleTypes || [];
        }

        const result = await reqPublishTaskBySet(requestValues);
        hide();
        if (result.code === 200) {
          message.success(result.message || '批量任务创建成功');
          setVisible(false);
          setDefaultValue({});
          actionRef.current.reload();
        } else {
          message.error(result.message || '批量任务创建失败');
        }
      } catch (error) {
        hide();
        console.error(error);
        message.error('按影像集创建任务失败');
      }
      return;
    }

    // 确保score是数字
    score = typeof score === 'number' ? score : Number(score) || 0;

    const selectedImages = [].concat(mapserver || []).filter(Boolean);
    if (selectedImages.length === 0) {
      message.error('请至少选择一个影像');
      return;
    }

    const selectableImageMap = new Map(
      selectableImageOptions.map((item) => [item.value, item]),
    );
    const serviceImages = [];
    const localImages = [];
    selectedImages.forEach((value) => {
      const option = selectableImageMap.get(value);
      if (option?.source === 'local') {
        localImages.push(option);
        return;
      }
      serviceImages.push({
        value,
        name: option?.name || value,
        mapserver: option?.mapserver || value,
      });
    });

    if (taskid && localImages.length > 0) {
      message.error('编辑任务暂不支持切换为本地影像，请新建任务');
      return;
    }

    // 如果是非团队任务且设置了积分，进行积分检查
    if (isNonTeamTaskLogic && score > 0) {
      if (currentUserScore < score) {
        message.error(`积分不足！您需要 ${score} 积分来发布该任务，但您只有 ${currentUserScore} 积分。`);
        return; // 终止操作
      }
    }

    if (taskid && selectedImages.length > 1) {
      message.error('编辑任务暂不支持一次修改多张影像，请新建任务');
      return;
    }

    const hide = message.loading('正在添加任务');
    try {
      const taskItems = [
        ...serviceImages.map((item) => ({
          source: 'geoserver',
          mapserver: item.mapserver,
          itemName: item.name || item.mapserver,
        })),
        ...localImages.map((item) => ({
          source: 'local',
          fileId: item.fileId,
          localImagePath: item.localImagePath,
          itemName: item.name || item.fileName,
        })),
      ];
      const requestValues = {
        ...buildTaskRequestValues({
          values,
          currentTaskName: taskname,
          daterange,
          taskid,
          type,
          targetUserType,
          score,
          mapserver: serviceImages[0]?.mapserver,
          localImagePath: localImages[0]?.localImagePath,
        }),
        ...(taskid ? {} : { taskItems }),
      };
      const result = taskid ? await reqEditTask(requestValues) : await reqNewTask(requestValues);

      hide();
      if (result.code !== 200) {
        message.error(result.message || '任务创建失败');
        return false;
      }
      setVisible(false);
      setDefaultValue({});
      message.success(taskid ? '任务更新成功！' : `成功创建 1 个多影像任务（${taskItems.length} 张）`);

      // 重新加载任务列表
      actionRef.current.reload();
    } catch (error) {
      hide();
      console.error('操作失败！', error);
      message.error('操作失败！');
      return false;
    }
  };

  // 控制机构列表数据展示
  const newOrEditTask = async () => {
    setVisible(true);
    // 获取用户的名称，仅在必要时获取数据
    if (typeList.length === 0) {
      getTypeInfo();
    }

    if (userList.length === 0) {
      getUserList({ isAdmin: 0 });
    }

    getServerListBySetName();
    loadSelectableImageOptions();
  };
  const confirm = async (id) => {
    try {
      await reqDeleteTask(id);
      actionRef.current.reloadAndRest();
      message.success('删除成功！');
    } catch (error) {
      message.error('删除失败！');
    }
  };
  // 新建任务获取机构下拉框
  const renderUserList = userList.map(({ userid, username }) => {
    return {
      value: username,
      label: username,
    };
  });
  // 新建任务获取影像下拉框（服务影像 + 本地影像）
  let renderServiceList = selectableImageOptions.map((item) => {
    return (
      <Select.Option value={item.value} key={item.value} label={item.label}>
        {item.label}
      </Select.Option>
    );
  });
  const columns = [
    {
      title: '序号',
      dataIndex: 'index',
      key: 'indexBorder',
      width: '5%',
      search: false,
      editable: false,
      align: 'center',
      valueType: 'indexBorder',
    },
    {
      disable: true,
      title: '任务名称',
      dataIndex: 'taskname',
      key: 'taskname',
      ellipsis: false,
      width: '15%',
      align: 'center',
      formItemProps: {
        rules: [
          {
            required: true,
            message: '此项为必填项',
          },
        ],
      },
    },
    {
      title: '标注类型',
      dataIndex: 'type',
      valueType: 'select',
      key: 'type',
      ellipsis: false,
      align: 'center',
      search: false,
      formItemProps: {
        rules: [
          {
            required: true,
            message: '此项为必填项',
          },
        ],
      },
      fieldProps: {
        options: [
          {
            label: '目标检测',
            value: '目标检测',
          },
          {
            label: '地物分类',
            value: '地物分类',
          },
        ],
      },
    },
    {
      disable: true,
      // width: '20%',
      align: 'center',
      title: '底图服务',
      ellipsis: false,
      dataIndex: 'mapserver',
      key: 'mapserver',
      search: false,
      editable: true,
      render: (text) => {
        // 确保显示完整的底图服务名称
        return <span title={text}>{text}</span>;
      },
    },
    {
      width: '10%',
      align: 'center',
      title: '任务期限区间',
      dataIndex: 'daterange',
      key: 'daterange',
      ellipsis: false,
      valueType: 'dateRange',
      search: false,
      formItemProps: {
        rules: [
          {
            required: true,
            message: '此项为必填项',
          },
        ],
      },
    // 自定义渲染逻辑，这里假设后端返回的是逗号分隔的字符串
    renderText: (val) => (typeof val === 'string' ? val.split(' ') : val),
},
    {
      align: 'center',
      title: '状态',
      width: 120,
      editable: false,
      search: true,
      dataIndex: 'status',
      key: 'status',
      sorter: true,
      valueType: 'select',
      valueEnum: {
        0: { text: '审核中' },
        1: { text: '审核通过' },
        2: { text: '审核未通过' },
        3: { text: '审核退回/未提交' },
      },
      fieldProps: {
        placeholder: '请选择状态',
        allowClear: true,
      },
      render: (_, record) => {
        const { color, text, icon } = getTaskStatusMeta(record);
        const content = record?.auditfeedback && text === '审核退回'
          ? <Tag color={color} icon={icon}><span title={record.auditfeedback}>{text}</span></Tag>
          : <Tag color={color} icon={icon}>{text}</Tag>;
        return (
          content
        );
      },
    },
    {
      title: '操作',
      width: '15%',
      align: 'center',
      // dataIndex: 'unitid',
      valueType: 'option',
      render: (text, record, index, action) => {
        // 批次折叠父行也提供“开始审核”入口（默认进入该批次第一条任务）
        if (record.isBatchGroup) {
          const firstTaskId = record.children?.[0]?.taskid;
          return [
            <Button
              key="startAuditBatch"
              type="primary"
              disabled={!firstTaskId || record.status > 1}
              onClick={() => {
                if (!firstTaskId) return;
                let taskId = Encrypt(firstTaskId);
                try {
                  const batchTaskIds = (record.children || [])
                    .map((item) => Number(item?.taskid))
                    .filter((id) => Number.isFinite(id) && id > 0);
                  if (batchTaskIds.length > 0) {
                    window.sessionStorage.setItem('auditTaskIds', JSON.stringify(batchTaskIds));
                  } else {
                    window.sessionStorage.setItem('auditTaskIds', JSON.stringify([Number(firstTaskId)]));
                  }
                  window.sessionStorage.removeItem('taskItemId');
                  window.sessionStorage.setItem('taskId', taskId);
                  history.push('/auditPage');
                } catch (error) {
                  message.error('底图服务加载失败或不存在');
                }
              }}
            >
              <ExpandOutlined /> 开始审核
            </Button>,
          ];
        }

        return [
          <a
            key="editable"
            onClick={() => {
              setDefaultValue(record);
              newOrEditTask();
            }}
          >
            编辑
          </a>,
          <Popconfirm
            title="你确定要删除吗?"
            onConfirm={() => {
              confirm(record.taskid);
            }}
            okText="是"
            cancelText="否"
            key={'confirm'}
          >
            <a key="delete">删除</a>
          </Popconfirm>,
          record.status == 1 ? (
            <Button
              type="primary"
              key={'getAuditInfo'}
              loading={loadingTaskId === record.taskid}
              onClick={async () => {
                setLoadingTaskId(record.taskid);
                const hide = message.loading('后台生成报告中...', 0);
                try {
                  const { taskid } = record;
                  const result = await getAuditInfo(taskid);
                  if (result && result.code === 200) {
                    setAuditReportData(result.data);
                    setIsReportModalVisible(true);
                  } else {
                    message.error(result.message || '获取报告失败！');
                  }
                } catch (error) {
                  console.error('报告生成失败:', error);
                  message.error('报告生成失败，请联系管理员！');
                } finally {
                  hide();
                  setLoadingTaskId(null);
                }
              }}
            >
              查看审核报告
            </Button>
          ) : (
            <Button
              onClick={async () => {
                let taskId = Encrypt(record.taskid);
                try {
                  const singleTaskId = Number(record.taskid);
                  if (Number.isFinite(singleTaskId) && singleTaskId > 0) {
                    window.sessionStorage.setItem('auditTaskIds', JSON.stringify([singleTaskId]));
                  }
                  window.sessionStorage.removeItem('taskItemId');
                  window.sessionStorage.setItem('taskId', taskId);
                  history.push('/auditPage');
                } catch (error) {
                  message.error('底图服务加载失败或不存在');
                }
              }}
              key="startAudit"
              type="primary"
              disabled={record.status > 1}
            >
              <ExpandOutlined /> 开始审核
            </Button>
          ),
        ];
      },
    },
  ];
  const editable = {
    type: 'multiple',
    // 保存的回调
    onSave: async (key, row, originRow) => {
      console.log("修改");
      console.log(row);
      try {
        let result = await reqEditTask(row);
        if (result) {
          message.success('修改成功！');
          actionRef.current.reload();
        }
      } catch (error) {
        message.error('修改失败,请检查数据是否存在！');
        actionRef.current.reload();
        return false;
      }
    },
    onDelete: async (_, row, index, action) => {
      console.log(row.taskid);
      try {
        let result = await reqDeleteTask(row.taskid);
        actionRef.current.reloadAndRest();
        message.success('删除成功！');
        console.log(actionRef.current);
      } catch (error) {
        message.error('删除失败！');
      }
    },
  };
  return (
    <PageContainer>
      <ProTable
        rowKey={(record) => record._rowKey || String(record.taskid)} // 支持批次折叠行
        columns={columns}
        actionRef={actionRef}
        // 1. 添加多选配置
        rowSelection={{
          onChange: (_, selectedRows) => {
            setSelectedRows(selectedRows);
          },
          // 只有审核通过的任务才能被选中用于生成数据集
          getCheckboxProps: (record) => ({
            disabled: record.isBatchGroup || record.status !== 1,
          }),
        }}
        request={async (params, sorter, filter) => {
          console.log("params in request:", params);
          // 提取状态筛选参数
          const { status } = params;
          const hasStatusFilter = status !== undefined && status !== null && status !== '';

          // 获取任务列表数据
          const data = await reqGetTaskList({ ...params, userId: currentState?.userid }, sorter, filter);

          if (data && data.data) {
            let items = data.data;

            // 客户端状态筛选（兼容后端未按状态过滤的情况）
            if (hasStatusFilter) {
              const statusNum = Number(status);
              items = items.filter((item) => Number(item.status) === statusNum);
            }

            // 对数据进行排序，使"审核中"(status=0)的记录排在前面
            items.sort((a, b) => {
              if (a.status === 0 && b.status !== 0) return -1;
              if (b.status === 0 && a.status !== 0) return 1;
              return 0;
            });

            // 批次折叠分组
            if (Array.isArray(items)) {
              const grouped = [];
              const batchMap = new Map();
              const isValidBatchId = (batchId) => {
                if (batchId === null || batchId === undefined) return false;
                const text = String(batchId).trim();
                if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') {
                  return false;
                }
                return text.startsWith('BATCH_');
              };
              items.forEach((item) => {
                if (isValidBatchId(item.batchId)) {
                  const normalizedBatchId = String(item.batchId).trim();
                  if (!batchMap.has(normalizedBatchId)) batchMap.set(normalizedBatchId, []);
                  batchMap.get(normalizedBatchId).push(item);
                } else {
                  grouped.push(item);
                }
              });

              batchMap.forEach((batchItems, batchId) => {
                const sortedItems = [...batchItems].sort((a, b) => (a.batchIndex || 0) - (b.batchIndex || 0));
                const first = sortedItems[0];
                grouped.push({
                  ...first,
                  _rowKey: `batch-${batchId}`,
                  taskname: `${first.taskname?.replace(/_\d+$/, '') || '批次任务'}（${sortedItems.length}）`,
                  mapserver: '批次折叠',
                  isBatchGroup: true,
                  children: sortedItems.map((t) => ({ ...t, _rowKey: `task-${t.taskid}` })),
                });
              });
              data.data = grouped;
            }
          }

          return data;
        }}
        expandable={{
          defaultExpandAllRows: false,
        }}
        editable={editable}
        search={{
          labelWidth: 'auto',
        }}
        pagination={{
          pageSizeOptions: ['10', '20', '30', '50'],
          defaultPageSize: 10,
          showSizeChanger: true,
        }}
        headerTitle="任务管理"
        // 添加防抖和缓存配置
        debounceTime={300}
        revalidateOnFocus={false} // 防止页面获得焦点时重新请求
        polling={false} // 禁用轮询
        toolBarRender={() => [
          <Button
            key="generate"
            type="primary"
            danger // 用个不同颜色区分
            disabled={selectedRowsState.length === 0}
            onClick={() => setDatasetModalVisible(true)}
          >
            生成样本集 ({selectedRowsState.length})
          </Button>,
          <Button key="button" icon={<PlusOutlined />} type="primary" onClick={newOrEditTask}>
            新建
          </Button>,
        ]}
      />
      {visible && (
        <CollectionCreateForm
          open={visible}
          defaultValue={defaultValue}
          onCreate={onCreate}
          onCancel={() => {
            setVisible(false);
            setDefaultValue({});
          }}
          renderUserList={renderUserList}
          renderServiceList={renderServiceList}
          selectableImageOptions={selectableImageOptions}
          renderTypeList={typeList}
        />
      )}
      {/* 将 Modal 组件渲染到页面上*/}
      <AuditReportModal
        visible={isReportModalVisible}
        data={auditReportData}
        onClose={() => {
          setIsReportModalVisible(false);
          setAuditReportData(null); // 关闭时清空数据，是个好习惯
        }}
      />
      {/* 3. 添加数据集生成配置 Modal */}
      <DatasetConfigModal
        visible={datasetModalVisible}
        selectedRows={selectedRowsState}
        onCancel={() => setDatasetModalVisible(false)}
        onCreate={handleGenerateDataset}
      />
    </PageContainer>
  );
};

export default TaskManage;
