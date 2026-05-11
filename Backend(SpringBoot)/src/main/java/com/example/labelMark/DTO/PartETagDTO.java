package com.example.labelMark.DTO;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * @Description
 * @Author wh
 * @Date 2025/9/17
 */
@Getter
@Setter
@NoArgsConstructor
public class PartETagDTO {
    private int partNumber;
    private String etag;
}
