# 需求文档：模型辅助标注功能

## 简介

本功能为标注系统增加模型辅助标注能力，允许用户在标注页面选择已训练的模型，并使用模型自动生成矩形框或多边形标注，从而提高标注效率和准确性。

## 术语表

- **Annotation_System**: 标注系统，包含前端标注界面和后端处理服务
- **Model_Selector**: 模型选择器组件，用于展示和选择用户训练的模型
- **Trained_Model**: 已训练的模型，存储在 Backend(FastAPI)/models/ 目录下
- **Annotation_Tool**: 标注工具，包含模型辅助工具栏
- **Bounding_Box**: 矩形框标注，由左上角和右下角坐标定义
- **Polygon**: 多边形标注，由多个顶点坐标定义
- **Model_Inference_Service**: 模型推理服务，负责执行模型预测
- **Annotation_Result**: 标注结果，包含坐标、类别等信息
- **User**: 使用标注系统的用户

## 需求

### 需求 1：模型选择器展示

**用户故事：** 作为标注用户，我希望在标注页面的模型辅助工具下看到可用的训练模型列表，以便选择合适的模型进行辅助标注。

#### 验收标准

1. THE Model_Selector SHALL display a list of available Trained_Models
2. WHEN the markPage loads, THE Model_Selector SHALL retrieve the list of Trained_Models from the backend
3. THE Model_Selector SHALL display the model name for each Trained_Model
4. THE Model_Selector SHALL display the model type for each Trained_Model
5. WHEN no Trained_Models are available, THE Model_Selector SHALL display a message indicating no models are available

### 需求 2：模型选择功能

**用户故事：** 作为标注用户，我希望能够从模型列表中选择一个模型，以便使用该模型进行辅助标注。

#### 验收标准

1. WHEN a User clicks on a Trained_Model in the Model_Selector, THE Annotation_System SHALL mark that model as selected
2. THE Model_Selector SHALL provide visual feedback indicating which Trained_Model is currently selected
3. THE Annotation_System SHALL allow only one Trained_Model to be selected at a time
4. WHEN a User selects a different Trained_Model, THE Annotation_System SHALL deselect the previously selected model

### 需求 3：矩形框生成功能

**用户故事：** 作为标注用户，我希望点击生成按钮后能够自动生成矩形框标注，以便快速完成目标检测任务的标注工作。

#### 验收标准

1. WHERE a Trained_Model supports Bounding_Box detection, THE Annotation_Tool SHALL display a generate button for Bounding_Box annotations
2. WHEN a User clicks the Bounding_Box generate button, THE Annotation_System SHALL send the current image to the Model_Inference_Service
3. WHEN the Model_Inference_Service returns Bounding_Box predictions, THE Annotation_System SHALL render the Bounding_Box annotations on the image
4. THE Annotation_System SHALL render each Bounding_Box with coordinates returned by the Model_Inference_Service
5. WHEN the Model_Inference_Service returns an error, THE Annotation_System SHALL display an error message to the User

### 需求 4：多边形生成功能

**用户故事：** 作为标注用户，我希望点击生成按钮后能够自动生成多边形标注，以便快速完成图像分割任务的标注工作。

#### 验收标准

1. WHERE a Trained_Model supports Polygon segmentation, THE Annotation_Tool SHALL display a generate button for Polygon annotations
2. WHEN a User clicks the Polygon generate button, THE Annotation_System SHALL send the current image to the Model_Inference_Service
3. WHEN the Model_Inference_Service returns Polygon predictions, THE Annotation_System SHALL render the Polygon annotations on the image
4. THE Annotation_System SHALL render each Polygon with vertex coordinates returned by the Model_Inference_Service
5. WHEN the Model_Inference_Service returns an error, THE Annotation_System SHALL display an error message to the User

### 需求 5：标注结果编辑

**用户故事：** 作为标注用户，我希望能够编辑模型生成的标注结果，以便修正模型预测的错误。

#### 验收标准

1. WHEN the Annotation_System renders model-generated annotations, THE Annotation_System SHALL allow the User to edit the annotations
2. THE Annotation_System SHALL allow the User to move Bounding_Box corners
3. THE Annotation_System SHALL allow the User to move Polygon vertices
4. THE Annotation_System SHALL allow the User to delete model-generated annotations
5. THE Annotation_System SHALL allow the User to add new annotations manually

### 需求 6：标注结果保存

**用户故事：** 作为标注用户，我希望能够保存模型生成和编辑后的标注结果，以便后续使用这些标注数据。

#### 验收标准

1. WHEN a User clicks the save button, THE Annotation_System SHALL save all Annotation_Results to the backend
2. THE Annotation_System SHALL save both model-generated and manually created annotations
3. THE Annotation_System SHALL save the annotation type for each Annotation_Result
4. THE Annotation_System SHALL save the coordinates for each Annotation_Result
5. WHEN the save operation completes successfully, THE Annotation_System SHALL display a success message to the User
6. IF the save operation fails, THEN THE Annotation_System SHALL display an error message to the User

### 需求 7：模型推理性能

**用户故事：** 作为标注用户，我希望模型推理能够在合理的时间内完成，以便保持流畅的标注体验。

#### 验收标准

1. WHEN the Model_Inference_Service receives an inference request, THE Model_Inference_Service SHALL return results within 10 seconds for images smaller than 5MB
2. WHILE the Model_Inference_Service is processing a request, THE Annotation_System SHALL display a loading indicator to the User
3. IF the Model_Inference_Service does not respond within 30 seconds, THEN THE Annotation_System SHALL display a timeout error message

### 需求 8：模型类型支持

**用户故事：** 作为标注用户，我希望系统能够支持多种类型的模型，以便根据不同的标注任务选择合适的模型。

#### 验收标准

1. THE Annotation_System SHALL support DeepLab models for segmentation tasks
2. THE Annotation_System SHALL support U-Net models for segmentation tasks
3. THE Annotation_System SHALL support Fast-SCNN models for segmentation tasks
4. THE Annotation_System SHALL support YOLO models for object detection tasks
5. THE Annotation_System SHALL support SAM models for segmentation tasks
6. WHEN a Trained_Model type is not supported, THE Model_Selector SHALL not display that model in the list

### 需求 9：用户权限验证

**用户故事：** 作为系统管理员，我希望只有授权用户才能使用模型辅助标注功能，以便保护系统资源。

#### 验收标准

1. WHEN a User accesses the model-assisted annotation feature, THE Annotation_System SHALL verify the User has appropriate permissions
2. IF a User does not have permission to use model-assisted annotation, THEN THE Annotation_System SHALL hide the Model_Selector
3. THE Annotation_System SHALL only display Trained_Models that belong to the current User or are shared with the User

### 需求 10：标注结果可视化

**用户故事：** 作为标注用户，我希望能够清晰地看到模型生成的标注结果，以便快速判断标注质量。

#### 验收标准

1. THE Annotation_System SHALL render Bounding_Box annotations with distinct border colors
2. THE Annotation_System SHALL render Polygon annotations with distinct border colors
3. THE Annotation_System SHALL display confidence scores for each model-generated annotation
4. WHEN a User hovers over an annotation, THE Annotation_System SHALL highlight that annotation
5. THE Annotation_System SHALL display class labels for each annotation
