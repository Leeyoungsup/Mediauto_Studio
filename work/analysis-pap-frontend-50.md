# 50 · 활성 스캔 AI 분석과 Pap 검토

참조는 [Techcyte PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf) 37·39–47쪽, [42번 시연](workflow-verification-42.md), [43번 화면 대조](pdf-frontend-review-43.md)다.

| PDF | 확인한 화면·발표 내용 | MeDIAuto Studio 구현 |
|---|---|---|
| 37쪽 | Viewer 요청 팝업, 요청 유형과 담당자. 발표자는 수동 실행과 선실행 규칙을 설명했다. | **Analysis**에서 활성 스캔·염색·형식, 사용 가능한 모델 및 버전, 미가용 이유, 작업 상태와 실행 출처를 표시한다. 허용된 사용자는 실행·취소·재실행한다. **Run Details → Back to Slide Analysis**는 같은 스캔의 Analysis로 돌아온다. |
| 39–41쪽 | Ki-67·PR의 세포 분류 오버레이와 결과 카드, HER2 막 패턴과 Composite 카드. | Viewer의 **IHC Results**에서 해당 스캔의 원본·수정본, 세포 오버레이, 검증 자료 및 감사 이력을 연다. 알려진 IHC 염색에 결과가 없으면 상태를 표시한다. **IHC Review and Best Block**은 활성 스캔 맥락으로 이동하고 기존 담당자 권한을 적용한다. |
| 42쪽 | PD-L1 점수, 색상별 세포 유형과 집계. | **Show Result on Slide**는 완료 작업의 기록에 고정된 결과를 열며 현재 WSI 카메라를 유지한다. 해당 결과가 사라진 경우 오류를 명시한다. **PD-L1 Results → Open Report Draft**에서 같은 스캔의 보고로 이동한다. 검증된 조건에서 CPS/TPS를 동시 표시하며 오버레이는 선택한 버전의 세포를 사용한다. |
| 43–44쪽 | 전립선 Core/Level과 조직 구획, 피부·흑색종 후보와 Heatmap. | 기존 영역·레이어·후보와 모델 출처를 재사용한다. **Return to WSI**는 같은 스캔과 카메라로 돌아온다. 모델이 제공하지 않은 값과 검증이 필요한 값은 각 카드에 구분해 표시한다. |
| 45–47쪽 | WSI 곁 Pap 후보 그리드, 적절성·해석·미생물 입력, 연관 조직생검 비교. | 등록된 Pap 염색에서 **Pap Gallery**와 **Pap Review**를 표시한다. 후보의 스캔과 좌표를 유지하며 두 화면을 오간다. **Compare Related Biopsy**에서 권한이 확인된 독립 WSI를 열고, 각 검사·검체·염색·스캔을 표시한다. **Return to Pap Review**와 **Open Pap Gallery**는 Pap 스캔 맥락으로 복귀하며 해당 사용자의 저장 후보를 불러온다. |

실행 모델은 기존 계약에서 해당 스캔에 허용되는 PD-L1 원본 아카이브 Replay 및 IHC Image Preflight를 사용한다. HER2·Ki-67·ER·PR·전립선·피부·Pap의 저장된 결과는 각 스캔·검체·모델에 바인딩된 기존 자료에서 조회한다. PDF의 화면·발표 설명은 실제 모델 성능이나 임상 사용 승인의 근거와 구분한다.

## 재현

1. Worklist에서 분석용 케이스를 열고 Viewer에서 대상 스캔을 선택한다. **Analysis → Analysis Method → Run Analysis**를 사용한다. 실행 상태에 따라 취소·재실행하거나 **Run Details**를 확인한다. 완료 작업의 **Show Result on Slide**에서 실행에 연결된 결과와 동일 스캔을 확인한다.
2. 도구막대의 **IHC Results** 또는 **PD-L1 Results**에서 오버레이, 모델/분석 버전, 원본, 수정본, 검증 출처를 확인한다. 전립선과 피부는 **Prostate AI**, **Skin Review**에서 각각 Core/Level과 조직 영역, 방향·Heatmap·유사분열 후보를 확인한다. **Return to WSI**로 돌아간다.
3. 등록된 Pap 스캔에서 **Pap Gallery → 후보 선택 → Open Pap Review**로 이동한다. 현재 후보와 사람의 검토 입력을 확인한다. **Compare Related Biopsy**에서 확인된 연관 케이스의 **Open Independent Comparison**을 누른다. 각각 줌·팬 후 **Return to Pap Review**로 복귀해 저장된 후보가 다시 표시되는지 확인한다.

프런트와 합성 브라우저 시나리오를 변경했다. DB 마이그레이션이 없으며 롤백은 이 작업 커밋을 되돌린 뒤 프런트를 재빌드한다. 실제 기관의 임상 검증은 별도 확인 대상이다.

## 검증

Linux 6.8, Node 22.12.0, Python 3.10.20, 임시 PostgreSQL 18.6, Chrome 146에서 합성 케이스·모델 결과와 프로젝트 WSI 샘플을 사용했다.

```bash
npm --prefix frontend run build
scripts/verify-integration.sh --demo ihc
scripts/verify-integration.sh --demo pap
scripts/verify-integration.sh
git diff --check
```

- 빌드와 Alembic 검증, 분석·결과 계약 및 권한 테스트 25개, 브라우저 시나리오 11개(중복 제외)를 통과했다. 브라우저는 IHC, Pap, 전립선·피부 및 공통 Viewer 구간을 각각 임시 DB에서 실행했다. [계약·API](../.runtime/analysis-pap-50/api.log) · [IHC/HER2/PD-L1](../.runtime/analysis-pap-50/ihc-verified.log) · [Pap](../.runtime/analysis-pap-50/pap-verified.log) · [전립선·피부 및 Viewer](../.runtime/analysis-pap-50/tissue-final.log)
- 분석 실행·재실행과 정확한 결과 누락 표시, API 취소, 오버레이 토글·원본 복원, 스캔 간 격리, Pap 후보·권한 복원 및 두 독립 WSI를 확인했다. 포트 9920에서 최신 빌드와 정상 health 응답을 확인했다. [IHC 결과·감사](../.runtime/analysis-pap-50/ihc-restored-result-and-audit.png) · [Pap 후속 검토](../.runtime/analysis-pap-50/pap-completed-follow-up.png)
