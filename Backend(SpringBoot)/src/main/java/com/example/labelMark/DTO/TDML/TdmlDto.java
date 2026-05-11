package com.example.labelMark.DTO.TDML;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Data;

import java.util.List;

public class TdmlDto {

    @Data
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Root {
        private String type = "AI_EOTrainingDataset";
        private String id;
        private String name;
        private String description;
        private String license = "";
        private String version = "1.0";
        private Integer amountOfTrainingData;
        private Integer numberOfClasses;
        private String classificationScheme;
        private List<ClassEntry> classes;
        private String imageSize;
        private List<Task> tasks;
        private List<Labeling> labeling;
        private List<DataEntry> data;
    }

    @Data
    public static class ClassEntry {
        private String key;
        private Integer value;
    }

    @Data
    public static class Task {
        private String type = "AI_EOTask";
        private String id;
        private String description;
        private String taskType = "Semantic Segmentation";
    }

    @Data
    public static class Labeling {
        private String type = "AI_Labeling";
        private String id;
        private Scope scope;
        private Procedure procedure;
    }

    @Data
    public static class Scope {
        private String level = "dataset";
        private List<ScopeDescription> levelDescription;
    }

    @Data
    public static class ScopeDescription {
        private String dataset;
    }

    @Data
    public static class Procedure {
        private String type = "AI_LabelingProcedure";
        private String id;
        private List<String> methods;
        private List<String> tools;
    }

    @Data
    public static class DataEntry {
        private String type = "AI_EOTrainingData";
        private String id;
        private String datasetId;
        private String trainingType;
        private List<String> dataURL;
        private Integer numberOfLabels;
        private List<PixelLabel> labels;
    }

    @Data
    public static class PixelLabel {
        private String type = "AI_PixelLabel";
        private List<String> imageURL;
        private List<String> imageFormat;
        private Double confidence = 1.0;
    }
}
