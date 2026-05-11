import React from 'react';
import { AppstoreOutlined } from '@ant-design/icons';
import { Input, Select, Tag } from 'antd';

const FeatureAttributePanel = ({
  layerFeatureRows = [],
  selectedFeature,
  selectedCategoryConfig,
  selectedFeatureAttrJson = {},
  onFocusFeature,
  onUpdateAttr,
}) => {
  return (
    <div className="model-panel attribute-panel">
      <div className="model-block">
        <div className="model-block-title"><AppstoreOutlined /> 要素属性</div>
        <div className="attribute-summary">
          当前图层要素: {layerFeatureRows.length}
        </div>
        <div className="feature-attr-list">
          {layerFeatureRows.length === 0 && (
            <div className="attribute-empty">请选择图层并绘制要素</div>
          )}
          {layerFeatureRows.map((row) => (
            <button
              key={row.key}
              className={`feature-attr-item ${selectedFeature === row.feature ? 'active' : ''}`}
              onClick={() => onFocusFeature(row.feature)}
            >
              <span className="feature-label">{row.label}</span>
              <span className="feature-type">{row.typeName}</span>
              <Tag color={row.requiredCompleted ? 'green' : 'red'}>
                {row.requiredCompleted ? '必填完整' : '缺少必填'}
              </Tag>
            </button>
          ))}
        </div>
        {!selectedFeature && (
          <div className="attribute-empty">点击地图或列表选择一个要素后可编辑属性</div>
        )}
        {selectedFeature && !selectedCategoryConfig && (
          <div className="attribute-empty">当前类别未配置属性项</div>
        )}
        {selectedFeature && selectedCategoryConfig?.fields?.length > 0 && (
          <div className="attribute-form-grid">
            {selectedCategoryConfig.fields.map((field) => {
              const value = selectedFeatureAttrJson?.[field.key];
              return (
                <div className="attribute-form-item" key={field.key}>
                  <label>
                    {field.label}{field.unit ? ` (${field.unit})` : ''}{field.required ? '*' : ''}
                  </label>
                  {field.type === 'enum' ? (
                    <Select
                      size="small"
                      allowClear={!field.required}
                      value={value}
                      onChange={(nextValue) => onUpdateAttr(field.key, nextValue, field.type)}
                      options={(field.options || []).map((item) => ({ label: item, value: item }))}
                      placeholder={field.placeholder || `请选择${field.label}`}
                    />
                  ) : (
                    <Input
                      size="small"
                      type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}
                      value={value === undefined || value === null ? '' : value}
                      placeholder={field.placeholder || `请输入${field.label}`}
                      onChange={(event) => onUpdateAttr(field.key, event.target.value, field.type)}
                    />
                  )}
                  {field.remark ? <span className="field-remark">{field.remark}</span> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FeatureAttributePanel;

