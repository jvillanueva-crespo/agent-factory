## Factory

<!-- Configuration for /factory. Adjust the values to your project.
     Do not touch it while the factory is working: changing it invalidates the prompt cache. -->

- BASE_BRANCH: main
- BUILD: mvn -q -B -DskipTests compile
- TEST: mvn -q -B test
- LINT:
- TEST_REPORT: target/surefire-reports/*.xml
- MUTATION:
- MUTATION_REPORT:
- MUTATION_THRESHOLD: 70
- PROTECTED:
- MAX_PARALLEL: 3
- SIZE_S: 2,3
- SIZE_M: 5,8
