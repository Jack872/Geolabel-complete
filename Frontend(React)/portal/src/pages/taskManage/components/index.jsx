import { Modal, Form, Input, Select, DatePicker, message, Radio, InputNumber, Checkbox } from 'antd';
import moment from 'moment';
import { useEffect, useMemo, useState } from 'react';
import { useModel } from 'umi';
import { reqGetDatasetList } from '@/services/dataset/api';
import { reqGetAttributeDefs } from '@/services/taskManage/api';
const { RangePicker } = DatePicker;

// 封装模态框表单
export default ({
  open,
  onCreate,
  onCancel,
  renderUserList,
  renderServiceList,
  selectableImageOptions,
  defaultValue,
  renderTypeList,
}) => {
  const [form] = Form.useForm();
  const [userList, setUserList] = useState([]);
  const [typeList, setTypeList] = useState(renderTypeList);
  const [, setAssignmentVersion] = useState(0);
  const safeTypeList = useMemo(() => (Array.isArray(typeList) ? typeList : []), [typeList]);

  // 获取当前用户信息和影像集分组信息
  const { serverListBySetName, getServerListBySetName } = useModel('serverModel');
  const [mapSelectMode, setMapSelectMode] = useState('byName'); // 默认按影像名称选择
  const [userArrId, setUserArrId] = useState([]);
  const [datasetSetTypeMap, setDatasetSetTypeMap] = useState({});
  const [attributeDefs, setAttributeDefs] = useState([]);
  const localSelectableOptions = useMemo(
    () => (selectableImageOptions || []).filter((item) => item?.source === 'local' && item?.fileId),
    [selectableImageOptions],
  );
  let { taskid, taskname, type, mapserver, daterange, userArr } = defaultValue;
  const isEdit = !!taskid;
  const defaultTaskTypeAttributeValues = useMemo(() => {
    const rows = Array.isArray(defaultValue?.taskTypeAttributes) ? defaultValue.taskTypeAttributes : [];
    const typeSet = new Set();
    const typeAttrSelections = {};
    const typeAttrMeta = {};

    rows.forEach((row) => {
      const typeId = String(row?.typeId ?? '');
      const attrId = row?.attrId;
      if (!typeId || attrId === undefined || attrId === null) {
        return;
      }
      typeSet.add(Number(typeId));
      if (!typeAttrSelections[typeId]) {
        typeAttrSelections[typeId] = [];
      }
      if (!typeAttrSelections[typeId].includes(attrId)) {
        typeAttrSelections[typeId].push(attrId);
      }
      typeAttrMeta[`${typeId}_${attrId}`] = {
        isRequired: !!row?.isRequired,
        displayOrder: row?.displayOrder || typeAttrSelections[typeId].length,
        placeholder: row?.placeholder || '',
        remark: row?.remark || '',
      };
    });

    return {
      attributeTypeIds: Array.from(typeSet),
      typeAttrSelections,
      typeAttrMeta,
    };
  }, [defaultValue]);

  useEffect(() => {
    if (renderTypeList.length) {
      setTypeList(renderTypeList);
    }
    // 设置标签默认值;
    setUserList(
      userArr?.map(({ username, typeArr }) => {
        return {
          userName: username,
          //只保留数组中的类型名称用于显示
          typestring: typeArr.map(item =>{
            return item.typeName;
          }),
        };
      }),
    );
    // 获取影像集分组数据
    getServerListBySetName();

    // 获取影像集类型（service/local）
    (async () => {
      try {
        const result = await reqGetDatasetList();
        if (result?.code === 200 && Array.isArray(result.data)) {
          const typeMap = {};
          result.data.forEach((item) => {
            if (item?.name) {
              typeMap[item.name] = (item.setType || 'service').toLowerCase();
            }
          });
          setDatasetSetTypeMap(typeMap);
        }
      } catch (e) {
        console.error('获取影像集类型失败:', e);
      }
    })();

    (async () => {
      try {
        const result = await reqGetAttributeDefs();
        if (result?.code === 200 && Array.isArray(result.data)) {
          setAttributeDefs(result.data);
        } else {
          setAttributeDefs([]);
        }
      } catch (error) {
        setAttributeDefs([]);
      }
    })();
  }, [renderTypeList, form, getServerListBySetName]);

  useEffect(() => {
    if (userArr && userArr.length > 0) {
      const ids = userArr.map(({ id }) => id);
      const defaultUserArr = userArr.map(({ username }) => username);

      // ✅ 更新状态（触发渲染）
      setUserArrId(ids);

      // ✅ 同步更新表单字段
      form.setFieldsValue({
        userArr: defaultUserArr,
        userArrId: ids,
      });
    }
  }, [userArr, form]);
  // 转换时间
  if (daterange) {
    daterange=daterange.split(' ');
    daterange = {
      startValue: moment(daterange[0], 'YYYY-MM-DD'),
      endValue: moment(daterange[1], 'YYYY-MM-DD'),
      endOpen: false,
    };
  }
  const onChange = (value) => {
    console.log(`selected ${value}`);
  };
  const onSearch = (value) => {
    console.log('search:', value);
  };

  // 处理地图选择模式变更
  const handleMapSelectModeChange = (e) => {
    const mode = e.target.value;
    setMapSelectMode(mode);
    // 清空当前选择的底图
    form.setFieldsValue({ mapserver: [] });
  };

  // 渲染影像集选择器选项
  const renderSetNameOptions = () => {
    const mergedSetNames = Array.from(new Set([
      ...Object.keys(serverListBySetName || {}),
      ...Object.keys(datasetSetTypeMap || {}),
    ]));
    return mergedSetNames.map(setName => (
      <Select.Option key={setName} value={setName}>
        {setName}{datasetSetTypeMap[setName] === 'local' ? '（本地）' : '（服务）'}
      </Select.Option>
    ));
  };

  // 当选择影像集时的处理
  const handleSetNameChange = (setNames) => {
    if (!setNames || setNames.length === 0) {
      form.setFieldsValue({ mapserver: [] });
      return;
    }

    // 根据选择的影像集名称，找出所有对应的影像名称
    const selectedMapservers = [];
    setNames.forEach(setName => {
      if (serverListBySetName[setName]) {
        selectedMapservers.push(...serverListBySetName[setName]);
      }
    });

    // 更新表单的mapserver字段
    form.setFieldsValue({ mapserver: selectedMapservers });
  };

  const areAllSelectedSetsLocal = () => {
    const selectedSetNames = form.getFieldValue('setNames') || [];
    if (!selectedSetNames.length) return false;
    return selectedSetNames.every((name) => datasetSetTypeMap[name] === 'local');
  };

  const attrDefById = useMemo(() => {
    const map = {};
    (attributeDefs || []).forEach((item) => {
      const attrId = item?.attrId ?? item?.attr_id;
      if (attrId !== undefined && attrId !== null) {
        map[String(attrId)] = item;
      }
    });
    return map;
  }, [attributeDefs]);

  const typeNameById = useMemo(() => {
    const map = {};
    safeTypeList.forEach((item) => {
      if (item?.typeId !== undefined && item?.typeId !== null) {
        map[String(item.typeId)] = item?.typeName || item?.typename || String(item.typeId);
      }
    });
    return map;
  }, [safeTypeList]);

  const buildAssignedTypeMap = (formData, excludeUserName = '') => {
    const assignedTypeMap = {};
    (userList || []).forEach(({ userName }) => {
      if (!userName || userName === excludeUserName) {
        return;
      }
      const selectedTypeIds = formData?.[userName] || [];
      selectedTypeIds.forEach((typeId) => {
        const typeKey = String(typeId);
        if (!assignedTypeMap[typeKey]) {
          assignedTypeMap[typeKey] = userName;
        }
      });
    });
    return assignedTypeMap;
  };

  const buildTypeOptionsForUser = (userName, formData) => {
    const assignedTypeMap = buildAssignedTypeMap(formData, userName);
    return filteredOptions.map((item) => {
      const typeKey = String(item.typeId);
      const assignedUserName = assignedTypeMap[typeKey];
      return {
        value: item.typeId,
        label: assignedUserName
          ? `${item.typeName}（已分配给${assignedUserName}）`
          : item.typeName,
        disabled: !!assignedUserName,
      };
    });
  };

  const findDuplicateTypeAssignments = (formData) => {
    const ownerByTypeId = {};
    for (const { userName } of userList || []) {
      const selectedTypeIds = formData?.[userName] || [];
      for (const typeId of selectedTypeIds) {
        const typeKey = String(typeId);
        if (ownerByTypeId[typeKey]) {
          return {
            typeName: typeNameById[typeKey] || typeKey,
            firstUserName: ownerByTypeId[typeKey],
            secondUserName: userName,
          };
        }
        ownerByTypeId[typeKey] = userName;
      }
    }
    return null;
  };

  const buildTaskTypeAttributesPayload = (formData) => {
    const selectedTypeIds = formData.attributeTypeIds || [];
    const typeAttrSelections = formData.typeAttrSelections || {};
    const typeAttrMeta = formData.typeAttrMeta || {};
    const payload = [];

    selectedTypeIds.forEach((typeId) => {
      const typeKey = String(typeId);
      const selectedAttrIds = typeAttrSelections[typeKey] || [];
      selectedAttrIds.forEach((attrId, index) => {
        const metaKey = `${typeKey}_${attrId}`;
        const meta = typeAttrMeta[metaKey] || {};
        payload.push({
          typeId: Number(typeId),
          attrId: Number(attrId),
          isRequired: !!meta.isRequired,
          displayOrder: meta.displayOrder || index + 1,
          placeholder: meta.placeholder || '',
          remark: meta.remark || '',
        });
      });
    });

    return payload;
  };

  const getUserTypeOptions = (currentUserName) => {
    const formValues = form.getFieldsValue();
    const assignedTypeIds = new Set();

    userList?.forEach(({ userName }) => {
      if (userName === currentUserName) {
        return;
      }
      const selectedTypeIds = formValues[userName] || [];
      selectedTypeIds.forEach((typeId) => {
        assignedTypeIds.add(String(typeId));
      });
    });

    return safeTypeList
      .filter((item) => !assignedTypeIds.has(String(item.typeId)))
      .map((item) => ({
        value: item.typeId,
        label: item.typeName,
      }));
  };

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑任务' : '新建任务'}
      okText="提交"
      cancelText="取消"
      onCancel={onCancel}
      width={800}
      onOk={() => {
        form
          .validateFields()
          .then((values) => {
            if (isEdit) {
              onCreate({
                taskid,
                taskname: values.taskname,
                daterange: values.daterange,
              });
              return;
            }
            const formData = { ...values };
            formData.targetUserType = 'specificTeamUsers';
            formData.specificUserAssignments = userList?.map(({ userName }) => ({
              username: userName,
              typeArr: formData[userName] || [],
            })) || [];

            formData.taskTypeAttributes = buildTaskTypeAttributesPayload(formData);
            if (
              taskid
              && formData.taskTypeAttributes.length === 0
              && !Array.isArray(defaultValue?.taskTypeAttributes)
            ) {
              delete formData.taskTypeAttributes;
            }
            delete formData.attributeTypeIds;
            delete formData.typeAttrSelections;
            delete formData.typeAttrMeta;
            onCreate(formData);
          })
          .catch((info) => {
            console.log('Validate Failed:', info);
          });
      }}
    >
      <Form
        form={form}
        layout="horizontal"
        name="form_in_modal"
        initialValues={{
          modifier: 'public',
          mapSelectMode: 'byName', // 默认按影像名称选择
          ...defaultTaskTypeAttributeValues,
        }}
        labelCol={{ span: 6 }}
        wrapperCol={{ span: 16 }}
      >
        {taskid && (
          <Form.Item
            label="任务id"
            name="taskid"
            hidden={true}
            initialValue={taskid}
            rules={[{ required: true, message: '必须输入任务id！' }]}
          >
            <Input disabled={true} />
          </Form.Item>
        )}
        <Form.Item
          label="任务名称"
          name="taskname"
          initialValue={taskname}
          rules={[{ required: true, message: '必须输入任务名称！' }]}
        >
          <Input placeholder="请输入任务名称" />
        </Form.Item>
        <Form.Item
          label="标注类型"
          name="type"
          initialValue={type}
          rules={[{ required: !isEdit, message: '必须选择标注类型！' }]}
        >
          <Select placeholder="请选择标注类型" optionFilterProp="children" onChange={onChange} disabled={isEdit}>
            <Select.Option value="目标检测" key="1">
              目标检测
            </Select.Option>
            <Select.Option value="地物分类" key="2">
              地物分类
            </Select.Option>
          </Select>
        </Form.Item>

        <Form.Item
          label="底图选择方式"
          name="mapSelectMode"
          initialValue="byName"
        >
          <Radio.Group onChange={handleMapSelectModeChange} disabled={isEdit}>
            <Radio value="byName">按影像名称选择</Radio>
            <Radio value="bySetName">按影像集名称选择</Radio>
          </Radio.Group>
        </Form.Item>

        {mapSelectMode === 'byName' ? (
          <Form.Item
            label="影像名称"
            name="mapserver"
            initialValue={taskid ? [mapserver] : []}
            rules={[{ required: !isEdit, message: '必须选择影像！' }]}
            tooltip="支持同时选择服务影像和本地影像，系统会按所选影像逐一创建任务"
          >
            <Select
              mode="multiple"
              showSearch
              placeholder="请选择影像名称"
              optionFilterProp="label"
              onChange={onChange}
              onSearch={onSearch}
              disabled={isEdit}
              filterOption={(input, option) =>
                (option?.label || option?.value || '').toLowerCase().includes(input.toLowerCase())
              }
            >
              {renderServiceList}
            </Select>
          </Form.Item>
        ) : (
          <>
            <Form.Item
              label="影像集名称"
              name="setNames"
              rules={[{ required: !isEdit, message: '必须选择影像集！' }]}
              tooltip="支持服务影像集和本地影像集，系统会自动按影像逐一创建任务"
            >
              <Select
                mode="multiple"
                showSearch
                placeholder="请选择影像集"
                optionFilterProp="children"
                onChange={handleSetNameChange}
                disabled={isEdit}
                filterOption={(input, option) =>
                  option.children.toLowerCase().includes(input.toLowerCase())
                }
              >
                {renderSetNameOptions()}
              </Select>
            </Form.Item>

            <Form.Item
              label="底图服务"
              name="mapserver"
              rules={areAllSelectedSetsLocal() ? [] : [{ required: true, message: '必须选择底图服务！' }]}
              tooltip={areAllSelectedSetsLocal() ? "本地影像集不经过GeoServer，无需底图服务" : "根据所选影像集自动选择的底图"}
            >
              <Select
                mode="multiple"
                disabled
                placeholder={areAllSelectedSetsLocal() ? "本地影像集无需底图服务" : "底图服务（由影像集自动选择）"}
              />
            </Form.Item>
          </>
        )}

        <Form.Item
          label="任务期限"
          name="daterange"
          initialValue={[daterange?.startValue, daterange?.endValue]}
          rules={[{ required: true, message: '必须输入任务期限！' }]}
        >
          <RangePicker
            onChange={(date, dateString) => {
              console.log(date, dateString);
            }}
          />
        </Form.Item>

        {!isEdit && (
          <>
            <Form.Item
              label="任务受理人"
              name="userArr"
              tooltip="多人协同模式下，各成员分配的标签不可重复"
              rules={[{ required: !isEdit, message: '必须选择任务受理人！' }]}
            >
              <Select
                showSearch
                mode="multiple"
                showArrow
                allowClear
                disabled={isEdit}
                placeholder="请选择任务受理人"
                optionFilterProp="children"
                onChange={(value) => {
                  setUserList(
                    value.map((item) => {
                      return { userName: item, typestring: [] };
                    }),
                  );
                }}
                onSearch={onSearch}
                filterOption={(input, option) =>
                  option.children?.toLowerCase().includes(input.toLowerCase()) ||
                  option.label?.toLowerCase().includes(input.toLowerCase())
                }
                options={renderUserList}
              />
            </Form.Item>

            <Form.Item noStyle shouldUpdate>
              {() => userList?.map(({ userName, typestring }) => (
                <Form.Item
                  noStyle
                  key={userName}
                  shouldUpdate={(prevValues, currentValues) => (
                    userList.some(({ userName: itemUserName }) => prevValues[itemUserName] !== currentValues[itemUserName])
                  )}
                >
                  <Select
                    mode="multiple"
                    showArrow
                    allowClear
                    disabled={isEdit}
                    onChange={() => {
                      setAssignmentVersion((version) => version + 1);
                    }}
                    options={getUserTypeOptions(userName)}
                  />
                </Form.Item>
              ))}
            </Form.Item>
          </>
        )}

        {!isEdit && (<>
        <Form.Item
          label="属性配置类别"
          name="attributeTypeIds"
          tooltip="选择需要在标注时填写属性的类别（类别来自类别表）"
        >
          <Select
            mode="multiple"
            allowClear
            placeholder="请选择需要配置属性的类别"
            options={safeTypeList.map((item) => ({
              value: item.typeId,
              label: item.typeName,
            }))}
          />
        </Form.Item>

        <Form.Item
          noStyle
          shouldUpdate={(prevValues, currentValues) =>
            prevValues.attributeTypeIds !== currentValues.attributeTypeIds
            || prevValues.typeAttrSelections !== currentValues.typeAttrSelections
          }
        >
          {({ getFieldValue }) => {
            const selectedTypeIds = getFieldValue('attributeTypeIds') || [];
            if (selectedTypeIds.length === 0) {
              return (
                <Form.Item label="属性项配置">
                  <div style={{ color: '#999' }}>请选择至少一个类别后配置属性项</div>
                </Form.Item>
              );
            }
            return selectedTypeIds.map((typeId) => {
              const typeKey = String(typeId);
              const selectedAttrIds = getFieldValue(['typeAttrSelections', typeKey]) || [];
              return (
                <div key={typeKey} style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 12, marginBottom: 12 }}>
                  <Form.Item
                    label={`${typeNameById[typeKey] || typeKey}属性项`}
                    name={['typeAttrSelections', typeKey]}
                    tooltip="选择该类别在本任务中需要填写的属性"
                  >
                    <Select
                      mode="multiple"
                      allowClear
                      placeholder="请选择属性项"
                      options={(attributeDefs || []).map((attr) => ({
                        value: attr.attrId ?? attr.attr_id,
                        label: `${attr.attrName ?? attr.attr_name} (${attr.attrKey ?? attr.attr_key})`,
                      }))}
                    />
                  </Form.Item>

                  {selectedAttrIds.map((attrId, index) => {
                    const metaKey = `${typeKey}_${attrId}`;
                    const attrDef = attrDefById[String(attrId)];
                    return (
                      <div
                        key={metaKey}
                        style={{
                          marginLeft: 88,
                          border: '1px dashed #d9d9d9',
                          borderRadius: 6,
                          padding: '10px 12px',
                          marginBottom: 8,
                        }}
                      >
                        <div style={{ marginBottom: 8, fontWeight: 600 }}>
                          {attrDef?.attrName || attrDef?.attr_name || attrId}
                          <span style={{ marginLeft: 8, color: '#999', fontWeight: 400 }}>
                            {(attrDef?.dataType || attrDef?.data_type || 'string')}
                            {attrDef?.unit ? ` / ${attrDef.unit}` : ''}
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '120px 120px 1fr 1fr', gap: 8 }}>
                          <Form.Item name={['typeAttrMeta', metaKey, 'isRequired']} valuePropName="checked" style={{ marginBottom: 0 }}>
                            <Checkbox>必填</Checkbox>
                          </Form.Item>
                          <Form.Item name={['typeAttrMeta', metaKey, 'displayOrder']} initialValue={index + 1} style={{ marginBottom: 0 }}>
                            <InputNumber min={1} style={{ width: '100%' }} placeholder="排序" />
                          </Form.Item>
                          <Form.Item name={['typeAttrMeta', metaKey, 'placeholder']} style={{ marginBottom: 0 }}>
                            <Input placeholder="输入提示（可选）" />
                          </Form.Item>
                          <Form.Item name={['typeAttrMeta', metaKey, 'remark']} style={{ marginBottom: 0 }}>
                            <Input placeholder="填写说明（可选）" />
                          </Form.Item>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            });
          }}
        </Form.Item>
        </>)}

        {taskid && (
          <Form.Item
            name="userArrId"
            hidden
          >
            <Input type="hidden" />
          </Form.Item>
        )}

        {/*{taskid && (
          <Form.Item
            label="更新id"
            name="userArrId"
            initialValue={userArrId}
            hidden={true}
            rules={[{ required: true, message: '必须选择关系id！' }]}
          >
            <Select
              showSearch
              mode="multiple"
              showArrow
              allowClear
              placeholder="请选择关系id！"
              optionFilterProp="children"
              onChange={onChange}
              onSearch={onSearch}
              filterOption={(input, option) =>
                option.children.toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
        )}*/}
      </Form>
    </Modal>
  );
};
