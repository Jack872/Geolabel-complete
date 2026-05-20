package com.example.labelMark.service;

import com.example.labelMark.domain.SysFile;

import java.io.File;
import java.nio.file.Path;

public interface MinioFileResolveService {

    File resolveToLocalFile(Integer fileId, Path targetDir);

    File resolveToLocalFile(SysFile file, Path targetDir);
}
