package com.skytrix;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(scanBasePackages = "com.skytrix")
@EnableJpaRepositories(basePackages = "com.skytrix.repository")
@EntityScan(basePackages = "com.skytrix.model.entity")
@EnableScheduling
// Spring's built-in ConcurrentMapCache (no extra dependency — brownfield
// no-new-deps rule). Backs @Cacheable on quasi-static reference data
// (perf-audit finding B-C5).
@EnableCaching
public class SkytrixApplication {

	public static void main(String[] args) {
		SpringApplication.run(SkytrixApplication.class, args);
	}

}
