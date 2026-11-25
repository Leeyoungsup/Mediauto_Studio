# 48 · 케이스 문서와 보고

참조는 [Techcyte PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf) 25–30·32·38쪽과 [42번 일반·Frozen 시연](workflow-verification-42.md)이다.

| 근거 | PDF에서 확인한 화면 또는 발표 내용 | MeDIAuto Studio 구현 |
|---|---|---|
| 25–27쪽 | History의 기록 목록·본문, Media의 PDF 열람, 검체별 Gross Images | Viewer와 Case Details가 동일한 History·첨부 API를 사용한다. Viewer 문서의 **Return to Slides**는 열린 캔버스와 배율을 유지한다. **Open in Case Details**는 해당 문서와 출발 스캔을 주소에 포함한다. |
| 28쪽 | OR에 공개된 예비보고, 절제연 평가 및 콜백 정보 | Frozen Section에서 최신 예비보고 버전, OR 확인 수·실패 수, 전화 read-back을 확인한다. 정정 후 요약은 새 버전을 기준으로 갱신되고 이전 확인·콜백은 Published Version History에서 열 수 있다. |
| 29–30쪽 | Case Editor와 스캔 정보, Case Logs의 시간·사용자·행위·대상·결과 | Case Editor 경로와 출발 스캔 초점을 유지한다. Viewer와 Frozen에서 필터가 있는 Case Logs로 이동한다. Case Details 상단의 Case Logs는 대화상자로 열 수 있다. |
| 32쪽 | 사건별 In-app·Email·Push 체크박스, 발표에서 배정·자문·멘션을 예시로 설명 | Case와 Viewer의 Notes에서 Notification Preferences로 이동한다. **Back to Case Notes**에 케이스와 스캔을 함께 넘긴다. 수신함의 멘션은 기존처럼 해당 케이스 Notes를 연다. |
| 38쪽 | Positive/Total 입력 화면, 발표에서 수기 집계의 보고 활용을 설명 | 검체 단위 림프절 건수와 해당 버전의 출발 스캔을 기존 보고 근거로 유지한다. 보고에서 근거를 선택하거나 원본 슬라이드를 열며, 승인·정정 버전의 근거는 버전 이력에서 조회한다. |

PDF는 화면과 발표 설명의 근거다. 이번 변경 결정은 케이스와 출발 스캔을 주소에 포함하고, 일반 보고와 Frozen 예비보고의 상태를 각각의 버전 기준으로 표시하는 것이다. 포커스를 옮기는 보고 내 구역 버튼은 주소와 초안 편집 상태를 유지한다. Viewer를 나갔다가 다시 여는 경우 출발 스캔을 선택하며, 위치·배율은 기존 Viewer 복원 동작을 따른다.

## 재현

1. **Worklist → Case → Open Viewer**에서 대상 스캔을 선택한다. **History**, **Media**, **Gross Images**, **Notes**, **Case Logs**를 열고 **Return to Slides**를 누른다. 문서에서 **Open in Case Details**로 이동한 뒤 새로고침해 같은 문서와 출발 스캔이 표시되는지 확인하고, 상단 **Open Viewer**로 해당 스캔을 다시 연다.
2. **Notes → Notification Preferences → Back to Case Notes**에서 채널 설정과 댓글을 확인한 다음 Viewer로 복귀한다.
3. 일반 케이스에서 Viewer의 **Report Draft → Review Evidence → Save Draft → Submit for Review**로 이동한다. 허용된 계정으로 **Approve Report → Queue Mock LIS Delivery**를 실행한다. 이후 **Start Correction**을 사용해 새 버전을 승인·전송한다. **Browse Versions**에서 원래 버전과 근거를 확인한다.
4. Frozen 케이스는 Viewer 또는 Worklist의 **Frozen Section**으로 진입한다. 관리자가 OR 수신자를 허가한 후 병리의가 예비보고를 발행한다. OR 수신자가 해당 버전의 확인 문제를 기록한 후 ACK하고 병리의가 전화 read-back을 기록한다. 정정 후 새 버전의 확인·콜백 상태와 이전 버전 이력을 조회한다. 관리자는 OR 화면의 **Back to Frozen Section**으로 돌아간다. OR 전용 수신자는 권한이 부여된 결과 화면에서 확인한다.

변경은 프런트와 합성 브라우저 검증 스크립트에 적용했다. DB 마이그레이션이 없으며 롤백은 이 작업 커밋의 revert와 프런트 재빌드로 수행한다. 실제 EMR/LIS, 외부 이메일·Push, 임상 사용자 검토는 별도 검증 대상이다.

## 검증

Linux 6.8, Node 22.12.0, Python 3.10.20, 임시 PostgreSQL 18.6, Chrome 146에서 합성 환자·케이스·보고와 프로젝트 WSI 샘플을 사용했다.

```bash
npm --prefix frontend run build
scripts/verify-integration.sh
scripts/verify-integration.sh --demo general
scripts/verify-integration.sh --demo frozen
git diff --check
```

재현 명령은 위와 같다. 전체 실행에서 빌드, Alembic과 Python 59개를 확인했다. 첫 브라우저 실행에서 교체된 QC 스캔의 주소 때문에 Viewer 열기가 막히는 회귀를 수정했다. 이후 합성 Frozen 시연의 파일 ID가 Multi View에 이미 등록된 샘플 경로와 겹쳐 전용 임시 경로로 격리했다. 수정 후 브라우저 실행이 일반 보고까지 완료되고 실행 제한으로 종료되어, 후반 구간은 새 임시 DB에서 분리해 실행했다. 두 구간의 브라우저 시나리오 28개가 통과했다. 별도 Frozen 실행에서도 스캔 복귀, 정정 후 OR 재확인, 콜백 이력을 확인했다. 포트 9920에서 최신 빌드와 정상 health 응답을 확인했다. [초기 테스트 로그](../.runtime/case-48/run.log) · [일반·문서 브라우저 로그](../.runtime/case-48/browser-final.log) · [후반 브라우저 로그](../.runtime/case-48/browser-remaining.log) · [Frozen 독립 실행 로그](../.runtime/case-48/frozen-only.log)

[일반 보고 정정 화면](../.runtime/case-48/general-report-approved-correction.png) · [Frozen OR 새 버전 확인 화면](../.runtime/case-48/frozen-corrected-and-acknowledged.png)
