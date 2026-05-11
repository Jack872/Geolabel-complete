import React, { useState, useRef, useEffect } from 'react';
import { PageContainer } from '@ant-design/pro-layout';
import ProTable from '@ant-design/pro-table';
// 【修改】引入 Drawer, Space, Tag 提升交互体验
import { Button, message, Modal, Form, Input, Select, Upload, Popconfirm, Drawer, Space, Tag, Checkbox } from 'antd';
// 【新增】引入 RobotOutlined 图标
import { PlusOutlined, UploadOutlined, RobotOutlined, EyeOutlined } from '@ant-design/icons';
import { getModels, deleteModel, uploadModel } from './service';
import { useModel } from 'umi';
// 【新增】引入获取任务列表的 API (根据你的实际路径调整)
import { reqGetTaskList } from '@/services/taskManage/api.js';
import { currentState, getUserByUsername } from '@/services/login/api';
import { reqGetCategoryList } from '@/services/category/api';
// 【新增】引入你原来的模型工具面板组件
// 注意：请确保 ModelToolPanel.jsx 放在 components 目录下或对应路径
import ModelToolPanel from './components/ModelToolPanel';
import ModelDetailsDrawer from './components/ModelDetailsDrawer';
import './style.less';

const ModelManage = () => {
  const [createModalVisible, handleModalVisible] = useState(false);
  // 【新增】状态：控制训练抽屉的显示隐藏
  const [trainDrawerVisible, setTrainDrawerVisible] = useState(false);
  // 【新增】状态：控制模型详情抽屉
  const [detailsDrawerVisible, setDetailsDrawerVisible] = useState(false);
  const [selectedModelInfo, setSelectedModelInfo] = useState(null);
  // 【新增】状态：存储从后端获取的“已审核”任务
  const [reviewedTasks, setReviewedTasks] = useState([]);
  // 【新增】状态：存储用户在表格中勾选的、准备发送给训练模块的任务
  const [selectedTasksForTrain, setSelectedTasksForTrain] = useState([]);
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState([]);
  const actionRef = useRef();
  const [userId, setUserId] = useState(null);
  const [modelData, setModelData] = useState([]);
  const [fileUploaded, setFileUploaded] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState([]);

  // 从Umi全局状态获取用户信息
  const { initialState } = useModel('@@initialState');
  const currentUser = initialState?.currentState?.currentUser;

  // 获取用户信息
  useEffect(() => {
    const fetchUserData = async () => {
      console.log('Current user from global state:', currentUser);

      if (currentUser) {
        try {
          // 如果currentUser是对象
          if (typeof currentUser === 'object') {
            if (currentUser.userId) {
              setUserId(currentUser.userId);
              console.log('Set userId from global state object:', currentUser.userId);
            } else if (currentUser.id) {
              setUserId(currentUser.id);
              console.log('Set userId from global state object (id):', currentUser.id);
            } else {
              console.warn('User is logged in but userId not found in user object');
              console.log('Full currentUser object:', currentUser);
            }
          }
          // 如果currentUser是字符串 (例如 "c3")，它是用户名而不是用户ID
          else if (typeof currentUser === 'string') {
            console.log('currentUser is a string (username):', currentUser);

            try {
              // 通过用户名查询用户信息
              const response = await getUserByUsername(currentUser);
              console.log('User info response by username:', response);

              if (response && response.userId) {
                setUserId(response.userId);
                console.log('Set userId from username lookup:', response.userId);
              } else if (response && response.id) {
                setUserId(response.id);
                console.log('Set userId from username lookup (id):', response.id);
              } else if (response && response.userid) {
                setUserId(response.userid);
                console.log('Set userId from username lookup (userid):', response.userid);
              } else {
                console.warn('Could not find userId from username lookup');
                // 尝试从API获取当前状态
                await fetchCurrentState();
              }
            } catch (error) {
              console.error('Error fetching user by username:', error);
              // 如果通过用户名获取失败，尝试从当前状态获取
              await fetchCurrentState();
            }
          }
        } catch (e) {
          console.error('Error processing user info:', e);
          await fetchCurrentState();
        }
      } else {
        console.warn('No currentUser found in global state');
        // 如果没有找到用户，尝试通过API获取当前状态
        await fetchCurrentState();
      }
    };

    // 从当前状态获取用户信息的辅助函数
    const fetchCurrentState = async () => {
      try {
        const state = await currentState();
        console.log('Current state from API:', state);

        if (state && state.currentUser) {
          if (typeof state.currentUser === 'object') {
            if (state.currentUser.userId) {
              setUserId(state.currentUser.userId);
              console.log('Set userId from currentState API:', state.currentUser.userId);
            } else if (state.currentUser.id) {
              setUserId(state.currentUser.id);
              console.log('Set userId from currentState API (id):', state.currentUser.id);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching current state:', error);
        message.warning('未检测到登录信息，请重新登录');
      }
    };

    fetchUserData();
  }, [currentUser]);

  const parseModelDesMeta = (rawModelDes) => {
    if (!rawModelDes || typeof rawModelDes !== 'string') {
      return {};
    }
    try {
      const parsed = JSON.parse(rawModelDes);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
      return {};
    } catch (error) {
      return {};
    }
  };

  const parseJsonInput = (value, fallback = {}, label = 'JSON 字段') => {
    const text = (value || '').trim();
    if (!text) {
      return fallback;
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
      throw new Error(`${label} 必须是 JSON 对象`);
    } catch (error) {
      throw new Error(`${label} 格式错误: ${error.message}`);
    }
  };

  const buildModelSpec = (values, selectedFile) => {
    const supports = values.supports || [];
    const modelSpec = {
      framework: values.framework?.trim(),
      arch: values.arch?.trim(),
      variant: values.variant?.trim() || '',
      backbone: values.backbone?.trim() || '',
      encoder: values.encoder?.trim() || '',
      checkpointFormat: values.checkpointFormat?.trim(),
      weightFormat: values.weightFormat?.trim() || (selectedFile?.name?.split('.').pop() || '').toLowerCase(),
      inputChannels: Number(values.inputChannels),
      numClasses: Number(values.numClasses),
      constructorArgs: parseJsonInput(values.constructorArgsJson, {}, '构造参数 constructorArgs'),
      inferParams: parseJsonInput(values.inferParamsJson, {}, '默认推理参数 inferParams'),
      classMapping: parseJsonInput(values.classMappingJson, {}, '类别映射 classMapping'),
      applicableTypeIds: values.extraApplicableTypeIds || [],
      supports: {
        preAnnotation: supports.includes('preAnnotation'),
        qualityReference: supports.includes('qualityReference'),
        batchInference: supports.includes('batchInference'),
      },
      versionTag: values.versionTag?.trim() || '',
      description: values.description?.trim() || '',
    };
    return modelSpec;
  };

  // 拉取类别，用于“适用类别”多选
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await reqGetCategoryList({ current: 1, pageSize: 200 });
        if (res?.success && Array.isArray(res.data)) {
          setCategoryOptions(res.data);
        } else {
          setCategoryOptions([]);
        }
      } catch (error) {
        setCategoryOptions([]);
      }
    };
    fetchCategories();
  }, []);

  // 【新增】函数：专门获取“已审核”的任务，确保训练样本的高质量
  const fetchReviewedTasks = async () => {
    if (!userId) return;
    try {
      // 调用获取任务列表接口
      const response = await reqGetTaskList({
        // userid: userId,
        // 【关键点】这里过滤状态，只拉取审核通过的数据
        status: 1
      });

      if (response && Array.isArray(response.data)) {
        setReviewedTasks(response.data);
      }
    } catch (error) {
      console.error('获取审核任务失败:', error);
      message.error('无法获取待训练样本');
    }
  };

  // 【新增】副作用：当训练抽屉打开时，自动刷新已审核任务列表
  useEffect(() => {
    if (trainDrawerVisible) {
      fetchReviewedTasks();
    }
  }, [trainDrawerVisible, userId]);

  // 硬编码临时解决方案，如果通过API也无法获取用户ID
  useEffect(() => {
    if (!userId) {
      const hardcodedUserId = 10; // 从API响应中看到用户c3的ID是10
      console.log('No userId found, using hardcoded ID:', hardcodedUserId);
      setUserId(hardcodedUserId);
    }
  }, [userId]);

  // 加载模型数据
  useEffect(() => {
    const fetchModelData = async () => {
      if (userId) {
        try {
          console.log('Fetching model data for userId:', userId);
          const response = await getModels(userId);
          console.log('Model data response:', response);

          // 确保response是数组
          if (Array.isArray(response)) {
            setModelData(response.map((item) => {
              const meta = parseModelDesMeta(item.modelDes);
              return {
                ...item,
                modelDes: meta.description || '',
                modelMeta: meta,
              };
            }));
          } else if (response && Array.isArray(response.data)) {
            setModelData(response.data.map((item) => {
              const meta = parseModelDesMeta(item.modelDes);
              return {
                ...item,
                modelDes: meta.description || '',
                modelMeta: meta,
              };
            }));
          } else {
            console.warn('Response is not an array:', response);
            setModelData([]);
          }
        } catch (error) {
          console.error('Error fetching model data:', error);
          setModelData([]);
        }
      }
    };

    fetchModelData();
  }, [userId]);

  // 表单提交处理
  const handleSubmit = () => {
    if (!userId) {
      message.error('无法获取用户ID，请重新登录');
      return;
    }

    // 验证文件是否已上传
    if (!fileList || fileList.length === 0) {
      message.error('请选择模型文件');
      return;
    }

    // 获取表单数据
    form.validateFields().then(async (values) => {
      const hide = message.loading('正在上传模型文件，请稍候...');
      try {
        const formData = new FormData();
        const file = fileList[0].originFileObj || fileList[0];
        const modelSpec = buildModelSpec(values, file);
        formData.append('file', file);
        formData.append('modelName', values.modelName);
        formData.append('modelDes', JSON.stringify(modelSpec));
        formData.append('inputNum', String(modelSpec.inputChannels));
        formData.append('outputNum', String(modelSpec.numClasses));
        formData.append('taskType', values.taskType);
        formData.append('modelType', values.modelType || modelSpec.arch || '');
        formData.append('userId', userId.toString());

        console.log('Uploading model with data:', {
          modelName: values.modelName,
          modelSpec,
          inputNum: modelSpec.inputChannels,
          outputNum: modelSpec.numClasses,
          taskType: values.taskType,
          modelType: values.modelType || modelSpec.arch,
          userId: userId,
          file: file.name,
          fileSize: (file.size / 1024 / 1024).toFixed(2) + 'MB',
          fileType: file.type
        });

        const result = await uploadModel(formData);
        console.log('Upload model result:', result);

        hide();
        if (result && result.success) {
          message.success('模型上传成功');
          handleModalVisible(false);
          // 重新加载数据
          if (actionRef.current) {
            actionRef.current.reload();
          }
          // 清空表单和文件列表
          form.resetFields();
          setFileList([]);
          setFileUploaded(false);
        } else {
          const errorMsg = (result && result.message) || '上传失败，请确保已正确登录并填写所有必填字段';
          message.error(errorMsg);
          console.error('Upload failed with response:', result);
        }
      } catch (error) {
        console.error('Error uploading model:', error);
        hide();
        message.error(`上传失败: ${error.message || '未知错误'}`);
      }
    }).catch(errorInfo => {
      console.log('Validation failed:', errorInfo);
      message.error('表单验证失败，请检查输入');
    });
  };

  // 【新增：解决报错的关键函数】
  // 当 ModelToolPanel 内部批量训练任务提交成功后会回调此函数
  const handleBatchTrainComplete = (result) => {
    console.log('批量训练任务已提交:', result);

    // 1. 弹出成功提示
    message.success('批量训练任务已成功启动，请留意系统通知');

    // 2. 刷新 ProTable 模型列表（如果有新模型产生）
    if (actionRef.current) {
      actionRef.current.reload();
    }

    // 3. 刷新我们手动维护的模型数据状态
    const fetchModelData = async () => {
      if (userId) {
        const response = await getModels(userId);
        if (Array.isArray(response)) {
          setModelData(response.map((item) => {
            const meta = parseModelDesMeta(item.modelDes);
            return {
              ...item,
              modelDes: meta.description || '',
              modelMeta: meta,
            };
          }));
        } else if (response && Array.isArray(response.data)) {
          setModelData(response.data.map((item) => {
            const meta = parseModelDesMeta(item.modelDes);
            return {
              ...item,
              modelDes: meta.description || '',
              modelMeta: meta,
            };
          }));
        }
      }
    };
    fetchModelData();
  };

  const handleDelete = async (id) => {
    const hide = message.loading('正在删除...');
    try {
      const result = await deleteModel(id);
      console.log('Delete model result:', result);
      hide();
      if (result.success) {
        message.success('删除成功');
        // 重新加载数据
        if (actionRef.current) {
          actionRef.current.reload();
        }
      } else {
        message.error(result.message || '删除失败');
      }
    } catch (error) {
      console.error('Error deleting model:', error);
      hide();
      message.error('删除失败，请重试');
    }
  };

  const columns = [
    {
      title: '模型名称',
      dataIndex: 'modelName',
      sorter: true,
      align: 'center',
    },
    {
      title: '模型描述',
      dataIndex: 'modelDes',
      ellipsis: true,
      align: 'center',
    },
    {
      title: '任务类型',
      dataIndex: 'taskType',
      valueEnum: {
        '目标检测': { text: '目标检测' },
        '地物分类': { text: '地物分类' },
      },
      align: 'center',
    },
    {
      title: '算法类型',
      dataIndex: 'modelType',
      align: 'center',
    },
    {
      title: '输入通道数',
      dataIndex: 'inputNum',
      sorter: true,
      align: 'center',
    },
    {
      title: '输出通道数',
      dataIndex: 'outputNum',
      sorter: true,
      align: 'center',
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      align: 'center',
      render: (_, record) => [
        <Button
          key="view"
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => {
            setSelectedModelInfo({
              ...record,
              modelMeta: record.modelMeta || parseModelDesMeta(record.modelDes),
              userId: userId
            });
            setDetailsDrawerVisible(true);
          }}
        >
          查看详情
        </Button>,
        <Popconfirm
          key="delete"
          title="确定删除此模型吗？"
          onConfirm={() => handleDelete(record.modelId)}
        >
          <Button
            type="primary"
            danger
            size="small"
          >
            删除
          </Button>
        </Popconfirm>,
      ],
    },
  ];

  // 文件上传配置
  const uploadProps = {
    onRemove: () => {
      setFileList([]);
      setFileUploaded(false);
    },
    beforeUpload: (file) => {
      setFileList([file]);
      setFileUploaded(true);
      return false; // 阻止自动上传
    },
    fileList,
    accept: '.pth,.pt,.joblib,.pkl,.h5,.model',
    multiple: false,
    maxCount: 1,
  };

  return (
    <PageContainer className="model-manage-container">
      {userId ? (
        <>
        <ProTable
          headerTitle="模型列表"
          actionRef={actionRef}
          rowKey="modelId"
          search={false}
          toolBarRender={() => [
            // 【新增】工具栏按钮：启动模型训练入口
            <Button
              key="train"
              type="default"
              icon={<RobotOutlined />}
              onClick={() => setTrainDrawerVisible(true)}
            >
              启动模型训练 (样本库)
            </Button>,
            <Button
              type="primary"
              key="primary"
              onClick={() => handleModalVisible(true)}
            >
              <PlusOutlined /> 新建
            </Button>,
          ]}
          dataSource={modelData}
          columns={columns}
          pagination={{
            pageSize: 10,
          }}
          rowClassName={() => 'table-row-center'}
        />

        {/* 【新增】训练管理抽屉 */}
        <Drawer
        className="train-drawer"
        title="🚀 高质量样本训练控制台"
        width={850}
        open={trainDrawerVisible}
        onClose={() => {
        setTrainDrawerVisible(false);
        setSelectedTasksForTrain([]); // 关闭时重置选择
      }}
        destroyOnClose // 关闭时销毁子组件，确保状态重置
        extra={
        <Space>
        <Button onClick={() => setTrainDrawerVisible(false)}>关闭</Button>
        </Space>
      }
        >
        <div className="step-section">
        <div className="step-title">
          <span className="step-number">1</span>
          从已审核样本中勾选训练数据
        </div>
        <div className="step-description">
          当前可选: {reviewedTasks.length} 个已审核任务
        </div>
        <ProTable
        size="small"
        rowKey="taskid"
        columns={[
      { title: '任务名称', dataIndex: 'taskname' },
      { title: '任务类型', dataIndex: 'type' },
      {
        title: '状态',
        dataIndex: 'status',
        render: () => <Tag color="green">已审核</Tag>
      },
        ]}
        dataSource={reviewedTasks}
        search={false}
        options={false}
        pagination={{ pageSize: 5 }}
        // 【关键点】行选择逻辑，将选中的行存入 selectedTasksForTrain
        rowSelection={{
        type: 'checkbox',
        onChange: (_, selectedRows) => {
        // 适配 ModelToolPanel 内部需要的 userArr 数据结构
        const adaptedTasks = selectedRows.map(task => ({
        ...task,
        userArr: [{ username: currentUser, userid: userId }]
      }));
        setSelectedTasksForTrain(adaptedTasks);
      },
      }}
        />

        </div>
        <div className="step-section">
        <div className="step-title">
          <span className="step-number">2</span>
          配置并启动训练
        </div>
        <div className="step-description">
          已选择: {selectedTasksForTrain.length} 个样本
        </div>
      {/* 【关键点】引入原来的工具面板，并传入选中的已审核任务 */}
        <ModelToolPanel
        selectedTasks={selectedTasksForTrain}
        onBatchTrainComplete={handleBatchTrainComplete}
        onBatchInferenceComplete={() => actionRef.current?.reload()}
        />
        </div>
        </Drawer>

        {/* 模型详情抽屉 */}
        <ModelDetailsDrawer
          visible={detailsDrawerVisible}
          onClose={() => {
            setDetailsDrawerVisible(false);
            setSelectedModelInfo(null);
          }}
          modelInfo={selectedModelInfo}
        />
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '50px' }}>
          <h3>无法获取用户信息，请重新登录后尝试</h3>
        </div>
      )}



      <Modal
        className="model-upload-modal"
        title="📦 新增模型"
        visible={createModalVisible}
        onCancel={() => {
          handleModalVisible(false);
          form.resetFields();
          setFileList([]);
          setFileUploaded(false);
        }}
        footer={[
          <Button key="cancel" onClick={() => {
            handleModalVisible(false);
            form.resetFields();
            setFileList([]);
            setFileUploaded(false);
          }}>
            取消
          </Button>,
          <Button key="submit" type="primary" onClick={handleSubmit} disabled={fileList.length === 0}>
            提交
          </Button>
        ]}
      >
        <Form
          form={form}
          layout="vertical"
        >
          <Form.Item
            name="modelName"
            label="模型名称"
            rules={[{ required: true, message: '请输入模型名称' }]}
          >
            <Input placeholder="请输入模型名称" />
          </Form.Item>
          <Form.Item
            name="taskType"
            label="任务类型"
            rules={[{ required: true, message: '请选择任务类型' }]}
          >
            <Select placeholder="请选择任务类型">
              <Select.Option value="目标检测">目标检测</Select.Option>
              <Select.Option value="地物分类">地物分类</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="modelType"
            label="模型类型标签（model_type，仅展示/筛选）"
            rules={[{ required: true, message: '请选择模型类型标签' }]}
          >
            <Select placeholder="请选择模型类型标签">
              <Select.Option value="yolo">YOLO</Select.Option>
              <Select.Option value="deeplab">DeepLab</Select.Option>
              <Select.Option value="unet">UNet</Select.Option>
              <Select.Option value="light_unet">LightUNet</Select.Option>
              <Select.Option value="fast_scnn">FastSCNN</Select.Option>
              <Select.Option value="segformer">SegFormer</Select.Option>
              <Select.Option value="xgboost">XGBoost</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="framework"
            label="框架（framework）"
            rules={[{ required: true, message: '请输入框架名称' }]}
          >
            <Input placeholder="例如：pytorch / transformers / ultralytics / mmseg / sklearn" />
          </Form.Item>
          <Form.Item
            name="arch"
            label="网络架构（arch）"
            rules={[{ required: true, message: '请输入网络架构' }]}
          >
            <Input placeholder="例如：yolo / unet / deeplab / fast_scnn / segformer" />
          </Form.Item>
          <Form.Item
            name="variant"
            label="架构变体（variant）"
          >
            <Input placeholder="例如：unetplusplus / deeplabv3plus / yolov8-seg" />
          </Form.Item>
          <Form.Item
            name="backbone"
            label="主干网络（backbone）"
          >
            <Input placeholder="例如：resnet50 / efficientnet-b3" />
          </Form.Item>
          <Form.Item
            name="encoder"
            label="编码器（encoder）"
          >
            <Input placeholder="例如：efficientnet-b4" />
          </Form.Item>
          <Form.Item
            name="checkpointFormat"
            label="检查点格式（checkpointFormat）"
            rules={[{ required: true, message: '请选择检查点格式' }]}
          >
            <Select placeholder="请选择检查点格式">
              <Select.Option value="state_dict">state_dict</Select.Option>
              <Select.Option value="torchscript">torchscript</Select.Option>
              <Select.Option value="full_model">full_model</Select.Option>
              <Select.Option value="onnx">onnx</Select.Option>
              <Select.Option value="joblib">joblib</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="weightFormat"
            label="权重文件格式（weightFormat）"
          >
            <Input placeholder="例如：pth / pt / onnx / joblib（不填则自动推断）" />
          </Form.Item>
          <Form.Item
            name="inputChannels"
            label="输入通道数（inputChannels）"
            rules={[{ required: true, message: '请输入输入通道数' }]}
            initialValue={3}
          >
            <Input type="number" min={1} placeholder="例如：3 / 4 / 8" />
          </Form.Item>
          <Form.Item
            name="numClasses"
            label="类别数（numClasses）"
            rules={[{ required: true, message: '请输入类别数' }]}
            initialValue={2}
          >
            <Input type="number" min={1} placeholder="例如：2 / 6 / 20" />
          </Form.Item>
          <Form.Item
            name="classMappingJson"
            label="类别映射（classMapping JSON）"
            initialValue='{"0":2}'
            rules={[
              { required: true, message: '请输入类别映射 JSON' },
              {
                validator: async (_, value) => {
                  parseJsonInput(value, {}, '类别映射 classMapping');
                }
              }
            ]}
          >
            <Input.TextArea rows={3} placeholder='例如: {"0":2,"1":5}' />
          </Form.Item>
          <Form.Item
            name="constructorArgsJson"
            label="构造参数（constructorArgs JSON）"
            initialValue="{}"
            rules={[
              {
                validator: async (_, value) => {
                  parseJsonInput(value, {}, '构造参数 constructorArgs');
                }
              }
            ]}
          >
            <Input.TextArea rows={3} placeholder='例如: {"decoder_channels":[256,128,64,32,16]}' />
          </Form.Item>
          <Form.Item
            name="inferParamsJson"
            label="默认推理参数（inferParams JSON）"
            initialValue='{"conf_threshold":0.3,"slice_size":640,"min_object_size":50,"hole_size_threshold":10,"boundary_smoothing":1}'
            rules={[
              {
                validator: async (_, value) => {
                  parseJsonInput(value, {}, '默认推理参数 inferParams');
                }
              }
            ]}
          >
            <Input.TextArea rows={4} placeholder='例如: {"conf_threshold":0.25,"slice_size":640}' />
          </Form.Item>
          <Form.Item
            name="supports"
            label="能力开关（supports）"
            initialValue={['preAnnotation', 'qualityReference']}
          >
            <Checkbox.Group
              options={[
                { label: '预标注（preAnnotation）', value: 'preAnnotation' },
                { label: '质量参考（qualityReference）', value: 'qualityReference' },
                { label: '批量推理（batchInference）', value: 'batchInference' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="versionTag"
            label="版本标签（versionTag）"
          >
            <Input placeholder="例如：v1.0.0 / 2026-04-08" />
          </Form.Item>
          <Form.Item
            name="description"
            label="模型说明（description）"
            rules={[{ required: true, message: '请输入模型说明' }]}
          >
            <Input.TextArea rows={3} placeholder="说明该模型训练数据、适用场景和注意事项" />
          </Form.Item>
          <Form.Item
            name="extraApplicableTypeIds"
            label="适用类别（可选备注，不参与核心识别）"
          >
            <Select mode="multiple" placeholder="可选：用于备注模型适用目标类别" optionFilterProp="children" showSearch>
              {categoryOptions.map((item) => (
                <Select.Option key={item.typeId} value={item.typeId}>
                  {item.typeName}({item.typeId})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            label="模型文件"
            required
            help={fileList.length === 0 ? "请上传模型文件" : null}
            validateStatus={fileList.length === 0 ? "error" : "success"}
          >
            <Upload {...uploadProps}>
              <Button icon={<UploadOutlined />} disabled={fileList.length >= 1}>
                {fileList.length >= 1 ? `已选择: ${fileList[0].name}` : '选择文件'}
              </Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default ModelManage;
