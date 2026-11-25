# Curriculum & Standards Tracker

Zion staff use **Curriculum & Standards** in the Family Portal or Teacher Gradebook. Families use **Curriculum Progress**. Teachers see students assigned to their Gradebook classes. Office actions use the existing Admin role, including Zion’s existing admin account.

## Local setup

1. Start with the existing development portal database. Follow [K–8 Learning Record setup](MIDDLE_SCHOOL_SETUP.md) to install the math and Learning Record migrations if they are missing. Install [supabase_curriculum_tracker.sql](supabase_curriculum_tracker.sql) next. With a local development database URL, run `psql "$ZION_DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase_curriculum_tracker.sql`. Serve a local copy of the site using the development Supabase URL and publishable key.
2. From the repository root, prepare the private import using Python 3 with `pypdf` and Node.js. Keep the output outside the website repository.

   ```sh
   python3 scripts/prepare-curriculum-import.py \
     ~/Downloads/Zion_Arkansas_Curriculum_Standards_Map.pdf \
     ~/Downloads/Zion_Curriculum_Map_Package.zip \
     ~/Downloads/zion-curriculum-import.json
   ```

3. On the local site, sign in as a development Admin. Open **Curriculum & Standards → Catalog and periods**, upload the prepared JSON, select **Preview import**, and import the batch. The preview lists source differences. Imported review rows have no effect on student records until someone approves the specific link and component.
4. Create the student’s enrollment and legal name in **K–8 Learning Records**. The tracker uses the same enrollment and roster. Use the school year’s configured reporting periods in **Catalog and periods**. Open **Proficiency and grading by school year** to review the defaults or save a school-year override. The existing Gradebook term names are shown as a reference because those labels have no shared reporting-period calendar.
5. Run [tests/curriculum-tracker.test.sql](tests/curriculum-tracker.test.sql) in the disposable database after importing the package. The test uses synthetic accounts and rolls back its changes.

## Staff workflow

- **Student records → Lesson checklist.** Select the student, enrollment year, period, and subject. Choose a course level and format. A lesson checkbox records completion. An assignment score is optional and remains separate from standards proficiency. Use **Use a Gradebook score** to reuse an existing score from the student’s class for the selected period. A saved score is a snapshot. Select the original score again to refresh it if the source changes. An approved checkpoint asks the teacher to describe the evidence they verified and indicate whether the student independently demonstrated the component.
- **Standards and evidence.** Review the short list for the student’s enrolled grade. Expand a standard to see its components, verified work, and supplemental options. Save an observation or work sample directly, or assign and complete a supplement before verifying its evidence. Record Beginning, Developing, Meets, or Extends after verifying evidence. Meets and Extends require independent evidence for every component. Extends also requires a note about the more complex or unfamiliar application. **Not yet assessed** is separate. Evidence from an advanced grade remains attached to that grade. When a curriculum changes, review earlier work by selecting the original period or course.
- **Mapping review.** Open an Arkansas grade, subject, and standard. Compare source rows with the official expectation and the exact curriculum edition. Define separate components before approving a partial link. Add a plain-language description for the optional family standards summary. Select the school year and approve an item/component for instruction tracking or as an evidence checkpoint. Instruction tracking records that the approved component was taught. An evidence checkpoint prompts verification of the individual student’s work. Search leads stay in review. Add a separately reviewed mapping after verifying the assignment. A new decision applies to future work. Prior completion and evidence retain the mapping revision that was used.
- **Family preview and reports.** Confirm which results should be shared and add any approved accomplishment or next step. Preview and publish at the end of the reporting period. Open **Preview report** to prepare a dated progress or transfer PDF. For a Parent Partnership Council or midyear transfer, select the interim report type and choose an as-of date in the reporting period. The interim PDF uses results through that date and can be issued before the period closes. Final transfer records include earlier published periods. Each publication and issued PDF retains the scale and grading key used at the time. The issued PDF is retained verbatim. Select the family share checkbox when issuing if the family should be able to download it in **Curriculum Progress**.

## Curriculum imports

The initial import uses the ZIP inventory for all checklist items and the CSV registers and PDF as separate sources for review. The included grade 6 Beast Academy review is compared with the ZIP’s main review files. The PDF rows keep page references. Sources with different dispositions or item references remain visible in the Admin review. Missing or unmatched links stay unreviewed. The website serves the workspace code. The curriculum package and staff review data are loaded into Supabase under Admin access.

Reimport the same prepared file or upload the extracted Zion CSV files together from **Catalog and periods**. Reimporting the same data leaves it in place. A new edition gets a new catalog key. Review and choose the new course of study when the student changes editions.

Other curricula can be added with CSV headers as follows. Use a new catalog key for a new edition and a new review key for a revised source row. Upload related files together.

| File | Columns |
|---|---|
| Catalog | `key,subject,title,publisher,level,edition,source,suggested_grades,inventory_complete` |
| Checklist | `catalog_key,key,unit,sort_order,title,kind,page_ref,online_ref,source` |
| Review or coverage | `key,standard_key,catalog_key,item_key,disposition,covered,evidence_needed,source` |

Use a pipe between suggested grades. Checklist kinds are `lesson`, `section`, `assignment`, `assessment`, and `supplement`. A source review can leave `item_key` blank. Accepted dispositions are candidate, partial, search, supplement, checkpoint, needed, and unreviewed.

## School decisions

- Beginning, Developing, Meets, and Extends are the defaults. The assignment grading key uses the existing middle-school key when one is configured. Override it by school year when needed.
- Decide which checklist links have enough evidence for approval. Resolve the PDF and CSV differences and confirm standards components and thresholds before using a mapping in student reporting.
- Confirm elementary record signers, school contact information and transfer-record policy. Set the school contact and adopted grading key under **K–8 Learning Records → Office settings**.

Production deployment requires separate approval.
