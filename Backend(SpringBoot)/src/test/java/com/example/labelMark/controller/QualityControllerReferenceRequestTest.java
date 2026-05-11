package com.example.labelMark.controller;

import com.example.labelMark.DTO.quality.QualityEvaluationRequest;
import com.example.labelMark.DTO.quality.QualityReferenceRunRequest;
import com.example.labelMark.service.QualityEvalJobService;
import com.example.labelMark.service.QualityEvaluationService;
import com.example.labelMark.service.QualityProfileService;
import com.example.labelMark.service.QualityReportService;
import com.example.labelMark.service.impl.UserDetailsServiceImpl;
import com.example.labelMark.filter.JwtAuthenticationTokenFilter;
import com.example.labelMark.filter.JwtFilter;
import com.example.labelMark.utils.JwtUtil;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.TestPropertySource;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(QualityController.class)
@AutoConfigureMockMvc(addFilters = false)
@TestPropertySource(properties = "logging.config=classpath:logback-test.xml")
class QualityControllerReferenceRequestTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private QualityProfileService qualityProfileService;
    @MockBean
    private QualityEvaluationService qualityEvaluationService;
    @MockBean
    private QualityEvalJobService qualityEvalJobService;
    @MockBean
    private QualityReportService qualityReportService;
    @MockBean
    private JwtFilter jwtFilter;
    @MockBean
    private JwtAuthenticationTokenFilter jwtAuthenticationTokenFilter;
    @MockBean
    private UserDetailsServiceImpl userDetailsService;
    @MockBean
    private JwtUtil jwtUtil;

    @Test
    void runReference_shouldAcceptMultiSourcePayload() throws Exception {
        Map<String, Object> mocked = new LinkedHashMap<>();
        mocked.put("message", "ok");
        when(qualityEvaluationService.runReferenceEvaluationOnly(any(QualityReferenceRunRequest.class), anyString()))
                .thenReturn(mocked);

        String body = "{\n" +
                "  \"sampleSetId\": 101,\n" +
                "  \"confidenceThreshold\": 0.31,\n" +
                "  \"iouThreshold\": 0.57,\n" +
                "  \"batchSize\": 24,\n" +
                "  \"referenceScope\": \"all\",\n" +
                "  \"sampleRatio\": 0.5,\n" +
                "  \"referenceSources\": [\n" +
                "    {\"sourceId\": \"model-11\", \"sourceType\": \"model\", \"modelId\": 11, \"weight\": 0.5},\n" +
                "    {\"sourceId\": \"model-12\", \"sourceType\": \"model\", \"modelId\": 12, \"weight\": 0.5}\n" +
                "  ],\n" +
                "  \"fusionConfig\": {\"method\": \"staple\", \"maxIter\": 50, \"eps\": 0.0001, \"probThreshold\": 0.5, \"minAgreement\": 0.2}\n" +
                "}";

        mockMvc.perform(post("/quality/reference/run")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200));

        ArgumentCaptor<QualityReferenceRunRequest> reqCaptor = ArgumentCaptor.forClass(QualityReferenceRunRequest.class);
        ArgumentCaptor<String> operatorCaptor = ArgumentCaptor.forClass(String.class);
        verify(qualityEvaluationService).runReferenceEvaluationOnly(reqCaptor.capture(), operatorCaptor.capture());

        QualityReferenceRunRequest req = reqCaptor.getValue();
        assertThat(req.getSampleSetId()).isEqualTo(101);
        assertThat(req.getModelId()).isNull();
        assertThat(req.getReferenceSources()).hasSize(2);
        assertThat(req.getReferenceSources().get(0).getModelId()).isEqualTo(11);
        assertThat(req.getFusionConfig()).isNotNull();
        assertThat(req.getFusionConfig().getMethod()).isEqualTo("staple");
        assertThat(operatorCaptor.getValue()).isEqualTo("system");
    }

    @Test
    void submitEvaluation_shouldAcceptReferenceSourcesInReferenceModel() throws Exception {
        Map<String, Object> mocked = new LinkedHashMap<>();
        mocked.put("id", 999L);
        when(qualityEvalJobService.submitJob(any(QualityEvaluationRequest.class), anyString()))
                .thenReturn(mocked);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("sampleSetId", 202);
        body.put("qualityProfileId", 1);
        Map<String, Object> referenceModel = new LinkedHashMap<>();
        referenceModel.put("confidenceThreshold", 0.32);
        referenceModel.put("iouThreshold", 0.54);
        referenceModel.put("batchSize", 16);
        referenceModel.put("scopeMode", "sample");
        referenceModel.put("sampleRatio", 0.3);
        referenceModel.put("referenceSources", new Object[]{
                mapOf("sourceId", "model-21", "sourceType", "model", "modelId", 21, "weight", 0.4),
                mapOf("sourceId", "model-22", "sourceType", "model", "modelId", 22, "weight", 0.6)
        });
        referenceModel.put("fusionConfig", mapOf(
                "method", "staple",
                "maxIter", 60,
                "eps", 0.0001,
                "probThreshold", 0.52,
                "minAgreement", 0.25
        ));
        body.put("referenceModel", referenceModel);

        mockMvc.perform(post("/quality/evaluation/submit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200));

        ArgumentCaptor<QualityEvaluationRequest> reqCaptor = ArgumentCaptor.forClass(QualityEvaluationRequest.class);
        ArgumentCaptor<String> operatorCaptor = ArgumentCaptor.forClass(String.class);
        verify(qualityEvalJobService).submitJob(reqCaptor.capture(), operatorCaptor.capture());

        QualityEvaluationRequest req = reqCaptor.getValue();
        assertThat(req.getSampleSetId()).isEqualTo(202);
        assertThat(req.getReferenceModel()).isNotNull();
        assertThat(req.getReferenceModel().getReferenceSources()).hasSize(2);
        assertThat(req.getReferenceModel().getReferenceSources().get(1).getModelId()).isEqualTo(22);
        assertThat(req.getReferenceModel().getFusionConfig()).isNotNull();
        assertThat(req.getReferenceModel().getFusionConfig().getProbThreshold()).isEqualTo(0.52);
        assertThat(operatorCaptor.getValue()).isEqualTo("system");
    }

    @Test
    void runReference_shouldKeepLegacySingleModelCompatible() throws Exception {
        when(qualityEvaluationService.runReferenceEvaluationOnly(any(QualityReferenceRunRequest.class), anyString()))
                .thenReturn(new LinkedHashMap<>());

        String body = "{ \"sampleSetId\": 303, \"modelId\": 33, \"confidenceThreshold\": 0.3, \"iouThreshold\": 0.5 }";

        mockMvc.perform(post("/quality/reference/run")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200));

        ArgumentCaptor<QualityReferenceRunRequest> reqCaptor = ArgumentCaptor.forClass(QualityReferenceRunRequest.class);
        verify(qualityEvaluationService).runReferenceEvaluationOnly(reqCaptor.capture(), anyString());
        assertThat(reqCaptor.getValue().getModelId()).isEqualTo(33);
        assertThat(reqCaptor.getValue().getReferenceSources()).isNull();
    }

    private static Map<String, Object> mapOf(Object... kv) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            map.put(String.valueOf(kv[i]), kv[i + 1]);
        }
        return map;
    }
}
