import React, { useState } from 'react';
import {
  Modal,
  Upload,
  Button,
  List,
  Progress,
  message,
  Col,
  Row,
  Form,
  Select,
  Input,
  Tooltip,
  InputNumber,
  DatePicker,
  Divider,
} from 'antd';
import { CloudUploadOutlined, FolderAddOutlined, DeleteOutlined, EyeOutlined, InfoCircleOutlined } from '@ant-design/icons';
import prettyBytes from 'pretty-bytes';
import styles from '../index.less';
import { initMultipart, mergeMultipart, uploadChunk } from '@/services/dataManage/api';

const { Option } = Select;

// 常用坐标系选项
const COMMON_CRS_OPTIONS = [
  { value: 'NONE', label: '无坐标系 (NONE)', description: '像素坐标模式，不包含地理参考信息' },
  { value: 'EPSG:4326', label: 'WGS84 (EPSG:4326)', description: '世界大地坐标系，GPS常用' },
  { value: 'EPSG:3857', label: 'Web Mercator (EPSG:3857)', description: '网络墨卡托投影，Web地图常用' },
  { value: 'EPSG:3301', label: 'Estonian Coordinate System (EPSG:3301)', description: '爱沙尼亚坐标系' },
  { value: 'EPSG:2154', label: 'RGF93 / Lambert-93 (EPSG:2154)', description: '法国Lambert-93投影' },
  { value: 'EPSG:32633', label: 'WGS84 / UTM zone 33N (EPSG:32633)', description: 'UTM 33N投影' },
  { value: 'EPSG:32634', label: 'WGS84 / UTM zone 34N (EPSG:32634)', description: 'UTM 34N投影' },
  { value: 'EPSG:25832', label: 'ETRS89 / UTM zone 32N (EPSG:25832)', description: 'ETRS89 UTM 32N' },
  { value: 'EPSG:25833', label: 'ETRS89 / UTM zone 33N (EPSG:25833)', description: 'ETRS89 UTM 33N' },
];

const StepUploadModal = ({ open, onCancel, onUploadComplete , datasetId,title}) => {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentUploadFile, setCurrentUploadFile] = useState('');
  const [form] = Form.useForm();

  const hasValue = (value) => value !== null && value !== undefined && `${value}`.trim() !== '';

  const parseBandsInput = (rawValue) => {
    if (!hasValue(rawValue)) return undefined;
    const raw = `${rawValue}`.trim();
    if (!raw) return undefined;

    // 允许直接输入 JSON 数组
    if (raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          throw new Error('波段 JSON 必须是数组');
        }
        return JSON.stringify(parsed);
      } catch (error) {
        throw new Error('波段名称格式错误，请输入 JSON 数组或逗号分隔值');
      }
    }

    const list = raw
      .split(/[,\n，]/)
      .map((item) => item.trim())
      .filter(Boolean);

    return list.length ? JSON.stringify(list) : undefined;
  };

  const formatDateTime = (value) => {
    if (!value) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value.format === 'function') {
      return value.format('YYYY-MM-DD HH:mm:ss');
    }
    return undefined;
  };

  const buildMetadataPayload = (values) => {
    const payload = {
      crsName: values.crsName,
      acquisitionTimeStart: formatDateTime(values.acquisitionTimeStart),
      acquisitionTimeEnd: formatDateTime(values.acquisitionTimeEnd),
      timePrecision: values.timePrecision,
      timeZone: values.timeZone,
      sensorPlatform: values.sensorPlatform,
      provider: values.provider,
      bandCount: values.bandCount,
      bandsJson: parseBandsInput(values.bandsInput),
      widthPx: values.widthPx,
      heightPx: values.heightPx,
      pixelSizeX: values.pixelSizeX,
      pixelSizeY: values.pixelSizeY,
      dataType: values.dataType,
      nodataValue: values.nodataValue,
      cloudCover: values.cloudCover,
      processingLevel: values.processingLevel,
      license: values.license,
      usageScope: values.usageScope,
      remark: values.remark,
    };

    if (payload.acquisitionTimeStart && payload.acquisitionTimeEnd) {
      const start = new Date(payload.acquisitionTimeStart).getTime();
      const end = new Date(payload.acquisitionTimeEnd).getTime();
      if (!Number.isNaN(start) && !Number.isNaN(end) && end < start) {
        throw new Error('采集结束时间不能早于采集开始时间');
      }
    }

    return payload;
  };

  // 关闭并重置
  const handleCancel = () => {
    if (uploading) {
      message.warning('上传中，请等待完成');
      return;
    }
    resetState();
    onCancel();
  };

  const resetState = () => {
    setSelectedFiles([]);
    setUploading(false);
    setUploadProgress(0);
    setCurrentUploadFile('');
    form.resetFields();
  };

  // 文件上传参数
  const uploadProps = {
    name: 'tiff',
    multiple: true,
    withCredentials: true,
    accept: '.tif,.tiff,.jpg,.jpeg,.png',
    fileList: [],
    beforeUpload: (file) => {
      const isSupportedImage =
        ['image/tiff', 'image/jpeg', 'image/png'].includes(file.type) ||
        /\.(tif|tiff|jpg|jpeg|png)$/i.test(file.name);
      if (!isSupportedImage) {
        message.error('只能上传 TIF、JPG、JPEG、PNG 文件！');
        return false;
      }
      const isLt6G = file.size / 1024 / 1024 < 6000;
      if (!isLt6G) {
        message.error('文件大小不能超过 6G！');
        return false;
      }

      // ✅ 允许多次追加
      setSelectedFiles((prev) => {
        const map = new Map();
        [...prev, file].forEach((f) => map.set(`${f.name}-${f.size}`, f));
        return Array.from(map.values());
      });

      return false;
    },
  };

  // 删除文件
  const removeFile = (idx) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // ✅ 修改：修复预览功能，不再使用 new Image()，直接 window.open()
  const previewFile = (file) => {
    const url = URL.createObjectURL(file);
    const w = window.open('');
    w.document.write(`
      <html>
        <head><title>${file.name}</title></head>
        <body style="margin:0;padding:0;text-align:center;background:#f0f0f0;">
          <img src="${url}" style="max-width:100%;max-height:100vh;object-fit:contain;">
        </body>
      </html>
    `);
  };

  // 上传逻辑
  const startUpload = async () => {
    if (selectedFiles.length === 0) {
      message.error('请先选择至少一个文件！');
      return;
    }

    try {
      // 验证表单
      const values = await form.validateFields();
      const { coordinateSystem, customCrs, description, ...metadataValues } = values;

      // 确定最终使用的坐标系
      const finalCrs = coordinateSystem === 'custom' ? customCrs : coordinateSystem;
      const metadataPayload = buildMetadataPayload(metadataValues);

      if (!finalCrs) {
        message.error('请选择或输入坐标系！');
        return;
      }

      setUploading(true);

      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        setCurrentUploadFile(file.name);
        setUploadProgress(Math.round((i / selectedFiles.length) * 100));
        await uploadSingleFile(file, finalCrs, description, metadataPayload);
      }

      setUploadProgress(100);
      message.success('所有文件上传成功！');

      setTimeout(() => {
        setUploading(false);
        resetState();
        onUploadComplete();
        onCancel();
      }, 1500);
    } catch (error) {
      if (error.errorFields) {
        message.error('请完善表单信息');
      } else {
        console.error(error);
        message.error('上传失败：' + error.message);
      }
      setUploading(false);
    }
  };

  // 单个文件上传
  async function uploadSingleFile(file, coordinateSystem, description, metadataPayload) {
    if (!datasetId) {
      message.error('缺少 datasetId，无法上传');
      return;
    }
    const chunkSize = 10 * 1024 * 1024; // 10MB
    const totalChunks = Math.ceil(file.size / chunkSize);
    const uploadId = await initMultipart(file.name);
    const etags = [];

    const concurrency = async (tasks, limit = 5) => {
      const ret = [];
      const executing = [];
      for (const task of tasks) {
        const p = task().then((v) => {
          executing.splice(executing.indexOf(p), 1);
          return v;
        });
        ret.push(p);
        executing.push(p);
        if (executing.length >= limit) await Promise.race(executing);
      }
      return Promise.all(ret);
    };

    const tasks = Array.from({ length: totalChunks }, (_, i) => async () => {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const blob = file.slice(start, end);

      try {
        const etag = await uploadChunk(file.name, uploadId, i + 1, blob);
        const cleanEtag = etag.replace(/^"(.*)"$/, '$1');
        etags.push({ partNumber: i + 1, etag: cleanEtag });
      } catch (error) {
        throw new Error(`Chunk ${i + 1} 上传失败: ${error.message}`);
      }
    });

    await concurrency(tasks, 5);
    await mergeMultipart({
      fileName: file.name,
      uploadId,
      partETags: etags,
      fileSize: file.size,
      datasetId,
      coordinateSystem, // 添加坐标系信息
      description: description || "User manual upload via web portal",
      ...metadataPayload,
    });
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={handleCancel}
      width={900}
      footer={[
        <Button key="cancel" onClick={handleCancel} disabled={uploading}>
          取消
        </Button>,
        <Button key="upload" type="primary" loading={uploading} onClick={startUpload}>
          {uploading ? '上传中...' : '开始上传'}
        </Button>,
      ]}
      destroyOnClose
      maskClosable={!uploading}
    >
      <p style={{ color: '#888' }}>当前数据集ID：{datasetId || '未指定'}</p>

      {/* 坐标系配置表单 */}
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          coordinateSystem: 'EPSG:3857', // 默认值
          description: '',
          timePrecision: 'day',
          timeZone: 'Asia/Shanghai',
        }}
        style={{ marginBottom: 20, padding: '16px', background: '#f8f9fa', borderRadius: '6px' }}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label={
                <span>
                  坐标系
                  <Tooltip title="选择影像数据的坐标参考系统，这将影响后续的地理处理和显示">
                    <InfoCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                  </Tooltip>
                </span>
              }
              name="coordinateSystem"
              rules={[{ required: true, message: '请选择坐标系' }]}
            >
              <Select
                placeholder="选择坐标系"
                showSearch
                optionFilterProp="children"
                filterOption={(input, option) =>
                  option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
                }
              >
                {COMMON_CRS_OPTIONS.map(crs => (
                  <Option key={crs.value} value={crs.value} title={crs.description}>
                    {crs.label}
                  </Option>
                ))}
                <Option value="custom">自定义坐标系...</Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              noStyle
              shouldUpdate={(prevValues, currentValues) =>
                prevValues.coordinateSystem !== currentValues.coordinateSystem
              }
            >
              {({ getFieldValue }) => {
                const coordinateSystem = getFieldValue('coordinateSystem');
                return coordinateSystem === 'custom' ? (
                  <Form.Item
                    label="自定义坐标系"
                    name="customCrs"
                    rules={[
                      { required: true, message: '请输入坐标系代码' },
                      { pattern: /^EPSG:\d+$/, message: '格式应为 EPSG:XXXX' }
                    ]}
                  >
                    <Input
                      placeholder="例如: EPSG:4326"
                      style={{ textTransform: 'uppercase' }}
                    />
                  </Form.Item>
                ) : (
                  <div style={{ paddingTop: 30, color: '#666', fontSize: '12px' }}>
                    {COMMON_CRS_OPTIONS.find(crs => crs.value === coordinateSystem)?.description}
                  </div>
                );
              }}
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          label="描述信息（可选）"
          name="description"
        >
          <Input.TextArea
            placeholder="添加关于此次上传的描述信息，将记录在溯源系统中"
            rows={2}
            maxLength={200}
            showCount
          />
        </Form.Item>

        <Divider orientation="left" style={{ marginTop: 8 }}>
          影像属性（可选）
        </Divider>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="坐标系名称" name="crsName">
              <Input placeholder="例如: WGS 84 / UTM zone 50N" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="时间精度" name="timePrecision">
              <Select>
                <Option value="year">年</Option>
                <Option value="month">月</Option>
                <Option value="day">天</Option>
                <Option value="hour">小时</Option>
                <Option value="minute">分钟</Option>
                <Option value="second">秒</Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="采集时间开始" name="acquisitionTimeStart">
              <DatePicker style={{ width: '100%' }} showTime format="YYYY-MM-DD HH:mm:ss" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="采集时间结束" name="acquisitionTimeEnd">
              <DatePicker style={{ width: '100%' }} showTime format="YYYY-MM-DD HH:mm:ss" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="时区" name="timeZone">
              <Input placeholder="例如: Asia/Shanghai, UTC+8" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="传感器/平台" name="sensorPlatform">
              <Input placeholder="例如: Sentinel-2A / UAV / GF-2" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="数据提供方" name="provider">
              <Input placeholder="例如: ESA / Planet / 自采" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="处理级别" name="processingLevel">
              <Input placeholder="例如: L1C / L2A / Ortho" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item label="波段数" name="bandCount">
              <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="例如: 4" />
            </Form.Item>
          </Col>
          <Col span={16}>
              <Form.Item
              label="波段名称"
              name="bandsInput"
              extra='支持 JSON 数组或逗号分隔，例如 ["R","G","B","NIR"] 或 R,G,B,NIR'
            >
              <Input.TextArea rows={2} placeholder='例如: ["R","G","B","NIR"]' />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item label="宽度(px)" name="widthPx">
              <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="例如: 4096" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="高度(px)" name="heightPx">
              <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="例如: 3072" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="云量(%)" name="cloudCover">
              <InputNumber min={0} max={100} style={{ width: '100%' }} placeholder="例如: 12.5" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="像素大小 X" name="pixelSizeX">
              <InputNumber style={{ width: '100%' }} placeholder="例如: 0.5" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="像素大小 Y" name="pixelSizeY">
              <InputNumber style={{ width: '100%' }} placeholder="例如: 0.5" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="像元数据类型" name="dataType">
              <Select allowClear placeholder="例如: uint8">
                <Option value="uint8">uint8</Option>
                <Option value="uint16">uint16</Option>
                <Option value="int16">int16</Option>
                <Option value="int32">int32</Option>
                <Option value="float32">float32</Option>
                <Option value="float64">float64</Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="NoData 值" name="nodataValue">
              <Input placeholder="例如: 0 或 -9999" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="许可协议" name="license">
              <Input placeholder="例如: CC-BY-4.0 / 内部使用" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="使用范围" name="usageScope">
              <Input placeholder="例如: 标注训练/内部评测" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="备注" name="remark">
          <Input.TextArea rows={2} maxLength={300} showCount />
        </Form.Item>
      </Form>

      <div className={styles.stepContent}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Upload {...uploadProps}>
            <Button type="primary" icon={<CloudUploadOutlined />}>
              选择影像文件
            </Button>
          </Upload>
          <div style={{ marginTop: 8, color: '#888' }}>
            支持上传 TIF、TIFF、JPG、JPEG、PNG 格式影像，支持多次选择自动追加，且单文件大小不超过 6G
          </div>
        </div>

        {selectedFiles.length > 0 && (
          <>
            <List
              bordered
              dataSource={selectedFiles}
              header={<b>已选择的文件（共 {selectedFiles.length} 个）</b>}
              renderItem={(file, idx) => (
                <List.Item
                  actions={[
                    <Button
                      key="preview"
                      type="link"
                      icon={<EyeOutlined />}
                      onClick={() => previewFile(file)}
                    >
                      预览
                    </Button>,
                    <Button
                      key="remove"
                      type="link"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => removeFile(idx)}
                    >
                      删除
                    </Button>,
                  ]}
                >
                  <span>
                    <FolderAddOutlined style={{ marginRight: 8 }} />
                    {file.name}
                  </span>
                  <span>{prettyBytes(file.size || 0)}</span>
                </List.Item>
              )}
            />

            {uploading && (
              <div style={{ marginTop: 20, textAlign: 'center' }}>
                <p>当前上传文件：{currentUploadFile}</p>
                <Progress percent={uploadProgress} status="active" />
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default StepUploadModal;
