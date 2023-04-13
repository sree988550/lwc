import { LightningElement, track, api } from "lwc";
import { OmniscriptBaseMixin } from "vlocity_ins/omniscriptBaseMixin";
import { omniscriptUtils, commonUtils, dataFormatter } from "vlocity_ins/insUtility";
import { namespace } from "vlocity_ins/utility";
import dayjs from "vlocity_ins/dayjs";
import pubsub from "vlocity_ins/pubsub";
import CongaModal from "c/sgBrokerCongaModal";


const RELATIONSHIP_HEADER = "Relationship";
const DR_BUNDLE = "sgBrokerGetZip";
const OOA_PERCENT = 0.49;
const ERR_MSG_DEP_OVER_26 = 'Non-disabled dependents over the age of 25 at the effective date cannot be enrolled.';
const ERR_MSG_EMP_OVER_121 = 'Enter a valid date of birth.';
const ERR_MSG_EMP_UNDER_18 = 'The employee may not meet the minimum age requirement. If the birth date is correct, additional documentation will be required for enrollment.';
const getZipsFromMembers = (members, region) =>
  members.map((member) => ({
    zipcode: member.Zip_Code__c,
    region: region
  }));
const getRemoteParams = (members, region) => ({
  input: {
    Bundle: DR_BUNDLE,
    DRParams: getZipsFromMembers(members, region)
  },
  sClassName: "vlocity_ins.DefaultDROmniScriptIntegration",
  sMethodName: "invokeOutboundDR",
  options: {}
});
const C_LOG = (function (log) {
  const res = [];
  return {
    clear: () => (res.length = 0),
    print: () => console.log("sgBrokerAddSubscribers Logs", new Date().toLocaleTimeString(), res),
    push: (log) => res.push(log)
  };
})();

export default class SgBrokerAddSubscribers extends OmniscriptBaseMixin(LightningElement) {
  @api itemsPerPage = 10;
  @api censusMemberUploadLimit = 2000;
  @api censusTemplateName = "/resource/sgBrokerAddSubscribersTemplate";
  @api censusEnrollmentTemplateName = "/resource/sgBrokerAddSubscribersEnrollmentTemplate";
  @api displaySettings;
  @api fieldsetName;
  @api updateMembersResponse;
  @api isFromNewCustomerSetup = false;

  @track censusInfo = { total: 0, depCount: 0, empCount: 0, empChCount: 0, empSpCount: 0, empFaCount: 0 };
  @track employees = [];
  @track headers = [];
  @track showCensus = false;
  @track censusProxy = [];
  @track showOOAErrorMessage = false;

  region;
  serviceArea;
  censusId;
  isOOARuleValid = true;
  effectiveDate;
  empCensusUpdated = false;
  theme;
  stateData;
  currentPage = 0;
  isValidCensus = true;
  isLoaded = false;
  empDeps = {};
  selectedEmployee = null;
  planHeaderFieldName = `${namespace}ContractLineId__c`;
  relationshipValues = [
    "Employee",
    "Spouse",
    "Domestic Partner",
    "Child",
    "Over-age Disabled Dependent",
    "Not Covered"
  ];
  labels = {
    InsOSCensusEmployeeTotalCount: "TOTAL",
    InsOSCensusEmployeeOnlyCount: "# Employee Only",
    InsOSCensusEmployeeWithSpouseCount: "# Employee+Spouse",
    Save: "Save",
    InsOSCensusEmployeeDependents: "DEPENDENTS",
    InsOSCensusEmployeeSubscribers: "EMPLOYEES",
    InsOSCensusEmployeeWithChildCount: "# Employee+Child(ren)",
    InsOSCensusEmployeeWithFamilyCount: "# Employee+Family",
    InsOSCensusDownloadTemplate: "Download census template",
    InsOSCensusUploadMembers: "Upload census",
    InsOSCensusUploadNewMembers: "Upload new census",
    InsOSNcsEnrollmentSpreadsheet: "Upload New Spreadsheet",
    InsOSNcsUploadCensus: "Upload New Census",
    InsOsNcsDownloadDetails: "Download census details",
    InsOSCensusAddEmployee: "+ Add employee",
    InsOSCensusDeleteAllData: "Delete all employees",
    InsOSCensusErrorExceedRowCount: "File exceeds maximum row count {0} for upload.",
    InsOSCensusErrorMissingParameter: "Missing parameter: {0}",
    InsOSCensusRelationship: "Relationship",
    InsOSCensusDetails: "Column Mapping",
    LoadingUC: "Loading",
    InsCensusConfirmDeleteAll: "Are you sure you want to delete all members from your census?",
    InsButtonCancel: "No",
    InsValidateCensus: "Save Subscribers",
    CensusConfirmDeleteAll: "All members will permanently be removed.",
    ExpandAll: "Expand All",
    CollapseAll: "Collapse All",
    DownloadCensusDetails: "Download census details"
  };
  globalEmpError = '';
  globalDepError = '';
  uploadCensusBtnLabel;
  currentDate = new Date().toLocaleDateString("en-US");
  effectiveDateInPast;
  ncsCensusStarted = false;
  uploadErrorMessage = "";
  congaUrls;
  sortMembersKey = "vlocity_ins__LastName__c"; // future sorting key variable - set dropdown value to this variable
  formChannel = `sgBrokerAddSubscribers-${dataFormatter.uniqueKey()}`;
  pubsubCensusFileUploaded = {
    censusFileUploaded: this.handleFileUploadPubsub.bind(this)
  };
  censusKeelTemplateName = "/resource/sgBrokerAddSubscribersKeelTemplate";

  get census() {
    return this.censusProxy;
  }

  set census(value) {
    C_LOG.clear();
    this.censusProxy = value;
    C_LOG.push("Census Updated - Validating Zip Codes");
    this.validateZipcodes();
    C_LOG.print();
  }

  connectedCallback() {
    this.region = this?.omniJsonData?.GroupDetails?.SelectedRegion;
    this.censusId = this?.omniJsonData?.sObjects?.censusId;
    if (!this.isFromNewCustomerSetup) this.effectiveDate = this?.omniJsonData?.GroupDetails?.QuoteEffectiveDate;
    if (!!this.isFromNewCustomerSetup) this.effectiveDate = this?.omniJsonData?.GroupDetails?.RequestedEffectiveDate;
    this.effectiveDateInPast = this.evaluateEffectiveDate({
      effectiveDate: this.effectiveDate,
      currentDate: this.currentDate
    });
    this.formatAndSendEffectiveDate();
    this.empCensusUpdated = false;
    this.omniUpdateDataJson({
      EmpCensusUpdated: this.empCensusUpdated
    });
    this.stateData = omniscriptUtils.getSaveState(this);
    if (this.omniJsonDef.propSetMap.displaySettings) {
      this.displaySettings = JSON.parse(JSON.stringify(this.omniJsonDef.propSetMap.displaySettings || {}));
    }
    console.log('debug stateData', this.stateData);
    if (this.stateData && !this.updateMembersResponse) {
      this.parseSavedState(this.stateData);
    } else {
      this.init();
    }
    const dataOmniLayout = this.getAttribute("data-omni-layout");
    this.theme = dataOmniLayout === "newport" ? "nds" : "slds";
    this.itemsPerPage = parseInt(this.itemsPerPage, 10);
    this.censusMemberUploadLimit = parseInt(this.censusMemberUploadLimit, 10);
    this.congaUrls = JSON.parse(JSON.stringify(this?.omniJsonData?.CongaDocumentUrls));
    pubsub.register(this.formChannel, this.pubsubCensusFileUploaded);
    console.log('this.effectiveDate', this.effectiveDate);
  }

  handleFileUploadPubsub(payload) {
    const isFromNCS = Boolean(this.isFromNewCustomerSetup);
    this.omniApplyCallResp({
      NcsFileUpload: payload,
      PostCensusToOpportunity: isFromNCS
    });
  }

  evaluateEffectiveDate(dates) {
    let effectiveDateInPast = false;
    let effectiveDateObj = {
      year: parseInt(dates.effectiveDate.split("-")[0]),
      month: parseInt(dates.effectiveDate.split("-")[1]) - 1,
      day: parseInt(dates.effectiveDate.split("-")[2])
    };
    let currentDateObj = {
      year: parseInt(dates.currentDate.split("/")[2]),
      month: parseInt(dates.currentDate.split("/")[0]) - 1,
      day: parseInt(dates.currentDate.split("/")[1])
    };
    let effectiveDateStr = `${effectiveDateObj.month + 1}/${effectiveDateObj.day}/${effectiveDateObj.year}`;
    let currentDateStr = dates.currentDate;
    let effectiveDate = new Date(effectiveDateObj.year, effectiveDateObj.month, effectiveDateObj.day, 0);
    let currentDate = new Date(currentDateObj.year, currentDateObj.month, currentDateObj.day, 0);
    if (effectiveDate < currentDate || effectiveDateStr == currentDateStr) effectiveDateInPast = true;
    return effectiveDateInPast;
  }

  navigateToGroupDetails() {
    this.omniPrevStep();
  }

  init() {
    if (!this.censusId) {
      this.showError({
        message: this.labels.InsOSCensusErrorMissingParameter.replace("{0}", "censusId")
      });
      this.isValidCensus = false;
      this.isLoaded = true;
      return;
    }
    // Fetching census data from API
    this.loadCensus().then((response) => this.handleInitialCensusLoad(response));
    /**
     * START OF CHANGES FOR CPQ-7290: load existing census members and check
     * for errors.
     */
    // If new members were committed, add any new errors to the census data structure.
    if (this.updateMembersResponse) {
      this.loadCensus().then((loadResponse) => {
        let loadResponseParsed = JSON.parse(loadResponse);
        if (!!this.isFromNewCustomerSetup && loadResponseParsed?.census?.members?.length > 0)
          this.ncsCensusStarted = true;
        const newCensusMap = this.generateUpdatedCensusMap(loadResponse);
        this.handleUpdateCensusLoad(newCensusMap, JSON.stringify(this.updateMembersResponse));
        this.omniApplyCallResp({ updateCensusMembersResponse: false }, true);
      });
    }
  }
  /**
   * US: CPQ-7290
   *
   * Formats and sends effective date to omniscript JSON for
   * use in age calculation service.
   */
  formatAndSendEffectiveDate() {
    let effectiveDateArray = this.effectiveDate.split("-");
    let formattedEffectiveDate = effectiveDateArray[1] + "/" + effectiveDateArray[2] + "/" + effectiveDateArray[0];
    this.omniApplyCallResp({ daymonthyearEffectiveDate: formattedEffectiveDate }, true);
  }
  /**
   * Retrieves census members and header information from server API.
   */
  loadCensus() {
    let initAction = JSON.parse(JSON.stringify(this.omniJsonDef.propSetMap.initAction || {}));
    const inputMapFromProperties = {
      censusId: this.censusId,
      ...(this.fieldsetName && { fieldsetName: this.fieldsetName })
    };
    initAction.inputMap = { ...initAction.inputMap, ...inputMapFromProperties };
    // fetch census headers
    return this.invokeService(initAction, "InsCensusService", "getMembers").catch((err) =>
      this.showError({ message: err })
    );
  }
  /**
   * Handle initial census load response.
   * @param {Object} response
   */
  handleInitialCensusLoad(response) {
    this.isLoaded = true;
    const parsedData = JSON.parse(response);
    const responseError = parsedData.errors || parsedData.error;
    if (responseError && responseError !== "OK") {
      this.showError({ message: responseError });
      this.isValidCensus = false;
      return;
    }
    this.census = parsedData.census.members.map((m, index) => {
      m.memberIndex = index;
      m.uuid = dataFormatter.uniqueKey();
      return m;
    });
    this.initHeaders(parsedData.census.headers);
    this.calculateCensusInfo();
  }
  /**
   * Show error message using toast
   * @param {Object} error Error object
   */
  showError(error) {
    let message = Array.isArray(error.message) ? error.message[0] : error.message;
    commonUtils.showErrorToast.call(this, message);
  }
  /**
   * Set UI to previous saved state
   * @param {Object} stateData
   */
  parseSavedState(stateData) {
    this.census = stateData.census;
    this.headers = stateData.headers;
    this.labels = stateData.labels;
    this.calculateCensusInfo();
    this.isLoaded = true;
  }
  /**
   * Adds index property to header objects and assigns the resulting array to this.headers
   * @param {Array} fetchedHeaders Array of header objects
   */
  initHeaders(fetchedHeaders) {
    this.headers = fetchedHeaders.map((header, index) => {
      header.index = `${index}`;
      return header;
    });
  }
  /**
   * Creates AvailableFields list for insFileUpload component from header fields.
   * Adds "Relationship" field.
   * @returns {Array}
   */
  get filemapHeaders() {
    let mapHeaders = this.headers.map((header) => {
      return { value: header.name, label: header.label, allowMultiple: header.name === this.planHeaderFieldName };
    });
    // commented for cpq-11291 mapping custom Relationship__c field instead OOB Relationship when csv upload
    return mapHeaders;
  }
  /**
   * Extract following information from census data:
   * 1. Total Insured
   * 2. Employee Count
   * 3. Child count
   * 4. Spouse count
   * 5. Family count
   * 6. Employees
   */

  calculateCensusInfo(doNotSort) {
    var isCensusDataValid = true;
    let censusInfo = {
      total: this.census.length,
      depCount: 0,
      empCount: 0,
      empChCount: 0,
      empSpCount: 0,
      empFaCount: 0
    };
    let employees = [];
    let empDeps = {}; // Stores dependents information on primary member's ID
    //
    // SORTING - TEST JPG
    // - Can have default to Last Name sort
    // - Will always apply Last Name sort if no user action taken
    // - Can have Dropdown for sorting options: Last Name, First Name
    // - Selecting the dropdown will immediately apply the sort and leave as the default sorting option

    // - If new member added, should reset the Dropdown so the user can re-sort
    // - If existing field is edited, should reset the Dropdown so the user can re-sort
    if (!doNotSort) this.sortMembersByField(this.sortMembersKey);
    //
    //
    // FILTERING - TEST JPG
    // - Theoretically, should work if the filter will only apply to the user's view (front end, not back end)
    // - Must add a key to each census member like showMember = true
    // - Sorting input passes string to filterMembersByKeyword fns
    // - All members with First OR Last names that contain or partially contain this string will stay true
    // - Those that don't, showMember = false
    // - HTML repeat block will have if:true={employee.showMember} to hide/show
    // - The filtering fns must be called in this fns unless filter is cleared
    // - Set global variable for filterIsActive - true or false - to control this call in this function
    // - Needs to handle for No Results
    // this.filterMembersByKeyword(this.filterMembersKeyword);
    //
    this.validateZipcodes();
    this.census.forEach((member) => {
      if (dataFormatter.getNamespacedProperty(member, "IsPrimaryMember__c")) {
        // Check if a primary member
        if (this.selectedEmployee) {
          const selectedEmployeeIdentifier = dataFormatter.getNamespacedProperty(
            this.selectedEmployee,
            "MemberIdentifier__c"
          );
          const memberIdentifier = dataFormatter.getNamespacedProperty(member, "MemberIdentifier__c");
          if (selectedEmployeeIdentifier === memberIdentifier) {
            member.isSelected = true;
          }
        }
        // test filtering
        member.showMember = true;
        // test filtering
        employees.push(member);
        censusInfo.empCount = employees.length;
        /* below logic is used for hide Next button on census screen using isCensusDataValid boolean
           if any of the below fields are blank or null when user update member */
        if (
          member.vlocity_ins__FirstName__c == "" ||
          member.vlocity_ins__FirstName__c == null ||
          member.vlocity_ins__LastName__c == "" ||
          member.vlocity_ins__LastName__c == null ||
          member.Zip_Code__c == "" ||
          member.Zip_Code__c == null ||
          member.Relationship__c == "" ||
          member.Relationship__c == null ||
          !this.relationshipValues.includes(member.Relationship__c)
        )
          isCensusDataValid = false;
        if (
          this.isFromNewCustomerSetup &&
          (member.vlocity_ins__Birthdate__c == "" ||
            member.vlocity_ins__Birthdate__c == null ||
            member.vlocity_ins__Birthdate__c == "Invalid Date")
        )
          isCensusDataValid = false;
        if (
          !this.isFromNewCustomerSetup &&
          (member.vlocity_ins__Birthdate__c == "" ||
            member.vlocity_ins__Birthdate__c == null ||
            member.vlocity_ins__Birthdate__c == "Invalid Date") &&
          (member.Age__c === null || member.Age__c === "" || !/^[0-9]+$/g.test(member.Age__c))
        )
          isCensusDataValid = false;
        const ageEval = this.evaluateMemberAge(this.handleMemberAge(member.vlocity_ins__Birthdate__c, this.effectiveDate), member.Relationship__c);
        // Emp is 121 or over
        if ((!!member.vlocity_ins__Birthdate__c && ageEval.empOver121 || !!member.Age__c && +member.Age__c >= 121)
            && member.Relationship__c === 'Employee')
          isCensusDataValid = false;
      }
      else {
        const primaryMemberId = dataFormatter.getNamespacedProperty(member, "PrimaryMemberIdentifier__c");
        if (empDeps[primaryMemberId])
          empDeps[primaryMemberId].push(member);
        else
          empDeps[primaryMemberId] = [member];
      }
    });
    // Update census info
    employees.forEach((member, index) => {
      const memberIdentifier = dataFormatter.getNamespacedProperty(member, "MemberIdentifier__c");
      let hasSpouse = false;
      let hasChild = false;
      member.index = index;
      member.dependents = empDeps[memberIdentifier] ? empDeps[memberIdentifier] : [];
      member.dependents.forEach((dependent) => {
        censusInfo.depCount++;
        const dependentIsSpouse = dataFormatter.getNamespacedProperty(dependent, "IsSpouse__c");
        /*below logic is used for hide Next button on census screen using isCensusDataValid boolean,
          if any of the below fields are blank or null when user update the dependent*/
        if (!this.isFromNewCustomerSetup) {
          if (
            (dependent.vlocity_ins__Birthdate__c === "" ||
              dependent.vlocity_ins__Birthdate__c === null ||
              dependent.vlocity_ins__Birthdate__c === "Invalid Date") &&
            (dependent.Age__c === null || dependent.Age__c === "" || !/^[0-9]+$/g.test(dependent.Age__c))
          )
            isCensusDataValid = false;
        } else {
          if (
            dependent.vlocity_ins__Birthdate__c == "" ||
            dependent.vlocity_ins__Birthdate__c == null ||
            dependent.vlocity_ins__Birthdate__c == "Invalid Date"
          )
            isCensusDataValid = false;
        }
        if (
          dependent.Relationship__c == "" ||
          dependent.Relationship__c == null ||
          !this.relationshipValues.includes(dependent.Relationship__c)
        )
          isCensusDataValid = false;
        if (dependentIsSpouse)
          hasSpouse = true;
        else
          hasChild = true;
        const ageEvalDep = this.evaluateMemberAge(this.handleMemberAge(dependent.vlocity_ins__Birthdate__c, this.effectiveDate), dependent.Relationship__c);
        // Dep is 26 or over
        if ((!!dependent.vlocity_ins__Birthdate__c && ageEvalDep.depOver26 || !!dependent.Age__c && +dependent.Age__c >= 26)
            && dependent.Relationship__c === 'Child')
          isCensusDataValid = false;
      });
      if (hasSpouse && hasChild)
        censusInfo.empFaCount++;
      else if (hasSpouse && !hasChild)
        censusInfo.empSpCount++;
      else if (!hasSpouse && hasChild)
        censusInfo.empChCount++;
    });
    if (censusInfo.total > 0)
      this.showCensus = true;
    else {
      this.showCensus = false;
      this.ncsCensusStarted = false;
    }
    this.uploadCensusBtnLabelHandler();
    this.censusInfo = censusInfo;
    this.employees = employees;
    this.empDeps = empDeps;
    if (employees.length < 1)
      isCensusDataValid = false;
    this.omniUpdateDataJson({
      isCensusValid: isCensusDataValid
    });
    this.evaluateEditedMembers();
    this.omniApplyCallResp({ censusCountInfo: this.censusInfo }, true);
  }

  uploadCensusBtnLabelHandler() {
    if (!this.showCensus) {
      this.uploadCensusBtnLabel = this.labels.InsOSCensusUploadMembers;
    } else {
      this.uploadCensusBtnLabel = this.labels.InsOSCensusUploadNewMembers;
    }
  }
  /**
   * Creates a member object
   * @param {Boolean} addDependent If true, member is a dependent, else member is primary member
   * @param {Object} employee Employee member
   * @returns {Object} The member object
   */

  // Temporarily commented out due to dependent retrieval/setting issue
  // addNewMember(addDependent, employee) {
  //   let newMember = this.headers.reduce((result, header) => {
  //     result[header.name] = "";
  //     return result;
  //   }, {});
  //   newMember[`${namespace}IsPrimaryMember__c`] = !addDependent;
  //   /*cpq10872 changes start. Below logic is used for conditionally display next button on
  //       census screen based on isCensusvalid boolean this is false when add employee and dependent.*/
  //   this.omniUpdateDataJson({
  //     isCensusValid: false
  //   });
  //   newMember[`${namespace}MemberIdentifier__c`] = dataFormatter.uniqueKey();
  //   newMember.memberIndex = this.census.length; // Index starts at zero, so next one = current count
  //   newMember.uuid = dataFormatter.uniqueKey();
  //   newMember.edited = true;
  //   newMember[`${namespace}PrimaryMemberIdentifier__c`] = addDependent
  //     ? dataFormatter.getNamespacedProperty(employee, "MemberIdentifier__c")
  //     : "";
  //   //added for cpq 11291 for selecting default Employee option on Primary member Relationship field start
  //   if (!addDependent) {
  //     newMember.Relationship__c = "Employee";
  //     newMember[`${namespace}PrimaryMemberIdentifier__c`] = newMember[`${namespace}MemberIdentifier__c`];
  //   }
  //   return newMember;
  // }

  addNewMember(addDependent, employee) {
    let newMember = this.headers.reduce((result, header) => {
      result[header.name] = "";
      return result;
    }, {});
    newMember[`${namespace}IsPrimaryMember__c`] = !addDependent;
    if (!addDependent) {
      newMember.Relationship__c = "Employee";
    }
    this.omniUpdateDataJson({
      isCensusValid: false
    });
    newMember[`${namespace}MemberIdentifier__c`] = dataFormatter.uniqueKey();
    newMember[`${namespace}PrimaryMemberIdentifier__c`] = addDependent
      ? dataFormatter.getNamespacedProperty(employee, "MemberIdentifier__c")
      : newMember[`${namespace}MemberIdentifier__c`];
    newMember.memberIndex = this.census.length;
    newMember.uuid = newMember[`${namespace}MemberIdentifier__c`];
    newMember.edited = true;
    return newMember;
  }

  // Add new employee in census list and navigate to the last page (if paginatin exists).
  addEmployee() {
    if (this.isFromNewCustomerSetup) this.ncsCensusStarted = true;
    let member = this.addNewMember(false);
    this.census.push(member);
    this.calculateCensusInfo(true);
    this.navigateToLastPage();
  }
  // Handles 'selected' event for employee.
  handleEmployeeSelect(event) {
    this.selectedEmployee = null;
    for (let i = 0; i < this.employees.length; i++) {
      if (
        dataFormatter.getNamespacedProperty(this.employees[i], "MemberIdentifier__c") ===
        dataFormatter.getNamespacedProperty(event.detail, "MemberIdentifier__c")
      ) {
        this.employees[i].isSelected = !this.employees[i].isSelected;
        if (this.employees[i].isSelected) this.selectedEmployee = this.employees[i];
      }
    }
  }
  // Add new dependent under an employee record.
  handleNewDependent(ev) {
    const employee = this.employees.find(
      (e) =>
        dataFormatter.getNamespacedProperty(e, "MemberIdentifier__c") ===
        dataFormatter.getNamespacedProperty(ev.detail, "MemberIdentifier__c")
    );
    if (employee) {
      const member = this.addNewMember(true, employee);
      this.census.push(member);
      this.calculateCensusInfo();
    }
  }
  // Age evaluation - START
  handleMemberAge (memberValue, censusEffectiveDate) {
    return typeof memberValue === 'string'
           ? this.getMemberAgeFromBirthdate(memberValue, censusEffectiveDate)
           : memberValue;
  }

  getMemberAgeFromBirthdate (memberBirthdate, censusEffectiveDate) {
    const effectiveDate = new Date(censusEffectiveDate);
    const birthDate = new Date(memberBirthdate);
    const month = effectiveDate.getMonth() - birthDate.getMonth();
    let age = effectiveDate.getFullYear() - birthDate.getFullYear();
    return month < 0 || (month === 0 && effectiveDate.getDate() < birthDate.getDate()) ? --age : age;
  }

  evaluateMemberAge (memberAge, relationship) {
    return {
      depOver26: relationship === 'Child' && memberAge >= 26,
      empOver121: relationship === 'Employee' && memberAge >= 121,
      empUnder18: relationship === 'Employee' && memberAge < 18
    };
  }

  //test deepthi
  // Age evaluation - END
  // Updates member information in census.
  handleUpdate(ev) {
    let member = { ...ev.detail };
    let memberIndex = this.census.findIndex(m => dataFormatter.getNamespacedProperty(m, "MemberIdentifier__c") === dataFormatter.getNamespacedProperty(member, "MemberIdentifier__c"));
    //test sree
     if(member.Physical_Assertion__c==false && member.invalidZip==true)
     member.Out_of_Area__c = true;
    //test sree
    
    
    if (member.Relationship__c == "Employee") {
      member.vlocity_ins__IsPrimaryMember__c = true;
      member.vlocity_ins__IsSpouse__c = false;
    }
    else if (member.Relationship__c == "Spouse" || member.Relationship__c == "Domestic Partner") {
      member.vlocity_ins__IsSpouse__c = true;
      member.vlocity_ins__IsPrimaryMember__c = false;
    }
    else if (
      member.Relationship__c == "Child" ||
      member.Relationship__c == "Over-age Disabled Dependent" ||
      member.Relationship__c == "Not Covered"
    ) {
      member.vlocity_ins__IsPrimaryMember__c = false;
      member.vlocity_ins__IsSpouse__c = false;
    }
    if (memberIndex > -1) {
      member.edited = true;
      this.census[memberIndex] = member;
      // below condition used for removing error message on member if birth date is not blank
      if (
        member.Relationship__c == "Employee" &&
        member.vlocity_ins__Birthdate__c != "" &&
        member.error == "DOB and Relationship fields are required"
      )
        member.error = "";
      // below condition is for removing error message on dependent
      if (
        member.Relationship__c != "" &&
        member.Relationship__c != "Employee" &&
        member.vlocity_ins__Birthdate__c != "" &&
        member.error == "DOB and Relationship fields are required"
      )
        member.error = "";
      /* below condition is for displaying error message on members after enter
      first name, lastname,zipcode when either birthdate or relationships are blank/null */
      if (
        member.vlocity_ins__FirstName__c != "" &&
        member.vlocity_ins__LastName__c != "" &&
        member.Zip_Code__c != "" &&
        member.Relationship__c == ""
      )
        member.error = "DOB and Relationship fields are required";
      // DOB or Relationship fields missing, QQ
      if (
        !this.isFromNewCustomerSetup &&
        member.Relationship__c === "Employee" &&
        (member.vlocity_ins__Birthdate__c === null || member.vlocity_ins__Birthdate__c === "") &&
        (member.Age__c === null || member.Age__c === "" || !/^[0-9]+$/g.test(member.Age__c))
      )
        member.error = "The Date of Birth or Relationship field is required";
      // DOB or Relationship fields missing, NCS
      if (
        this.isFromNewCustomerSetup &&
        (member.vlocity_ins__Birthdate__c == "" || member.vlocity_ins__Birthdate__c == null)
      )
        member.error = "DOB and Relationship fields are required";
      const ageEval = this.evaluateMemberAge(this.handleMemberAge(member.vlocity_ins__Birthdate__c, this.effectiveDate), member.Relationship__c);
      const ageRulesEvaluated = this.evalAgeRules(member, ageEval);
      if (ageRulesEvaluated.hasError)
        member.error = ageRulesEvaluated.msg;
      this.calculateCensusInfo(true);
    }
    this.empCensusUpdated = true;
    this.omniUpdateDataJson({
      EmpCensusUpdated: this.empCensusUpdated
    });
  }

  evalAgeRules (member, ageEval) {
    let error = '';
    // Dep is 26 or over
    if ((!!member.vlocity_ins__Birthdate__c && ageEval.depOver26 || !!member.Age__c && +member.Age__c >= 26)
        && member.Relationship__c === 'Child')
      error = ERR_MSG_DEP_OVER_26;
    // Emp is 121 or over
    if ((!!member.vlocity_ins__Birthdate__c && ageEval.empOver121 || !!member.Age__c && +member.Age__c >= 121)
        && member.Relationship__c === 'Employee')
      error = ERR_MSG_EMP_OVER_121;
    // Emp is under 18
    else if ((!!member.vlocity_ins__Birthdate__c && ageEval.empUnder18 || !!member.Age__c && +member.Age__c < 18)
        && member.Relationship__c === 'Employee')
      error = ERR_MSG_EMP_UNDER_18;
    return {
      hasError: !!error,
      msg: error
    };
  }

  // Delete census member on button click
  handleDelete(ev) {
    const currentMemberIdentifier = dataFormatter.getNamespacedProperty(ev.detail, "MemberIdentifier__c");
    const dependents = this.empDeps[currentMemberIdentifier] || [];
    let memberIdentifiers = [currentMemberIdentifier];
    dependents.forEach((d) => memberIdentifiers.push(dataFormatter.getNamespacedProperty(d, "MemberIdentifier__c")));
    this.deleteMembers(memberIdentifiers);
    this.empCensusUpdated = true;
    this.omniUpdateDataJson({
      EmpCensusUpdated: this.empCensusUpdated
    });
  }
  // Delete all census members on button click
  clearAll() {
    const memberIdentifiers = this.census.map((member) =>
      dataFormatter.getNamespacedProperty(member, "MemberIdentifier__c")
    );
    this.deleteMembers(memberIdentifiers);
    this.closeDeleteAllModal();
    this.empCensusUpdated = true;
    this.omniUpdateDataJson({
      EmpCensusUpdated: this.empCensusUpdated
    });
  }
  /**
   * Delete census members using array of identifiers
   * @param {Array} memberIdentifiers Array of Member Identifiers
   */
  deleteMembers(memberIdentifiers) {
    let deletionIds = [];
    this.census.forEach((member) => {
      // Extract Ids for members
      if (
        memberIdentifiers.some((id) => dataFormatter.getNamespacedProperty(member, "MemberIdentifier__c") === id) &&
        member.Id
      ) {
        deletionIds.push({ Id: member.Id });
      }
    });
    if (deletionIds.length > 0) {
      // Make API call to delete the members
      this.isLoaded = false;
      let deleteAction = JSON.parse(JSON.stringify(this.omniJsonDef.propSetMap.deleteAction || {}));
      deleteAction.inputMap = { ...deleteAction.inputMap, ...this.censusInputMap(deletionIds) };
      this.invokeService(deleteAction, "InsCensusService", "deleteMembers")
        .then(() => {
          this.loadCensus().then((loadResponse) => {
            const newCensusMap = this.generateUpdatedCensusMap(loadResponse);
            this.handleDeleteCensusLoad(newCensusMap, memberIdentifiers);
          });
        })
        .catch((err) => this.showError({ message: err }));
    } else {
      // Delete members from client end since associate record ID is not created yet.
      this.census = this.census.filter(
        (member) => !memberIdentifiers.includes(dataFormatter.getNamespacedProperty(member, "MemberIdentifier__c"))
      );
      this.calculateCensusInfo();
      if (this.currentPageHasNoItems()) {
        this.navigateToLastPage();
      }
    }
  }

  evaluateFields(member) {
    let response = true;
    let fieldMap = {
      relationship: true,
      birthday: true
    };
    // Employee and Dependent - Relationship
    if (
      member.Relationship__c === "" ||
      member.Relationship__c === null ||
      !this.relationshipValues.includes(member.Relationship__c)
    )
      fieldMap.relationship = false;
    // Employee and Dependent - Birthday
    if (
      (member.vlocity_ins__Birthdate__c === "" ||
        member.vlocity_ins__Birthdate__c === null ||
        member.vlocity_ins__Birthdate__c === "Invalid Date") &&
      this.isFromNewCustomerSetup
    )
      fieldMap.birthday = false;
    if (
      !this.isFromNewCustomerSetup &&
      (member.vlocity_ins__Birthdate__c === null ||
        member.vlocity_ins__Birthdate__c === "" ||
        member.vlocity_ins__Birthdate__c === "Invalid Date") &&
      (member.Age__c === null || member.Age__c === "" || !/^[0-9]+$/g.test(member.Age__c))
    )
      fieldMap.birthday = false;
    // Employee evaluations
    if (member.Relationship__c === "Employee") {
      fieldMap.firstName = true;
      fieldMap.lastName = true;
      fieldMap.zipCode = true;
      // Employee - First Name
      if (member.vlocity_ins__FirstName__c === "" || member.vlocity_ins__FirstName__c === null)
        fieldMap.firstName = false;
      // Employee - Last Name
      if (member.vlocity_ins__LastName__c === "" || member.vlocity_ins__LastName__c === null) fieldMap.lastName = false;
      // Employee - Zip Code
      if (member.Zip_Code__c === "" || member.Zip_Code__c === null) fieldMap.zipCode = false;
    }
    const ageEval = this.evaluateMemberAge(this.handleMemberAge(member.vlocity_ins__Birthdate__c, this.effectiveDate), member.Relationship__c);
    // Dep is 26 or over
    if ((!!member.vlocity_ins__Birthdate__c && ageEval.depOver26 || !!member.Age__c && +member.Age__c >= 26) && member.Relationship__c === 'Child') {
      fieldMap.birthday = false;
      this.globalDepError = ERR_MSG_DEP_OVER_26;
    }
    else
      this.globalDepError = '';
    // Emp is 121 or over
    if ((!!member.vlocity_ins__Birthdate__c && ageEval.empOver121 || !!member.Age__c && +member.Age__c >= 121) && member.Relationship__c === 'Employee') {
      fieldMap.birthday = false;
      this.globalEmpError = ERR_MSG_EMP_OVER_121;
    }
    else if ((!!member.vlocity_ins__Birthdate__c && ageEval.empUnder18 || !!member.Age__c && +member.Age__c < 18) && member.Relationship__c === 'Employee') {
      // Emp is under 18
      this.globalEmpError = ERR_MSG_EMP_UNDER_18;
    }
    else
      this.globalEmpError = 'Required fields are missing.';
    for (let field in fieldMap) {
      if (!fieldMap[field]) {
        response = false;
        return response;
      }
    }
    return response;
  }

  zipMap = new Map();

  validateMemberZip(member) {
    if (member.Zip_Code__c !== null && member.Zip_Code__c !== "" && !this.zipMap.has(member.Zip_Code__c))
      member.invalidZip = true;
    else member.invalidZip = false;
  }

  markInvalidZips() {
    const dependents = [];
    this.census.forEach((member) => {
      this.validateMemberZip(member);
      if (member?.dependents) dependents.push(...member.dependents);
    });
    dependents.forEach((dependent) => {
      this.validateMemberZip(dependent);
    });
    if (this.isFromNewCustomerSetup) {
      const ooamem=[];
      const totals = this.census.reduce(
        (acc, member) => {
            if (member.vlocity_ins__IsPrimaryMember__c === true) acc.totalEmp++;
          if (member.vlocity_ins__IsPrimaryMember__c === true && member.invalidZip && !member?.Physical_Assertion__c)
          
          { ooamem.push(member);
            acc.totalOOA++;
          }
        
        return acc;
        },

        { totalEmp: 0, totalOOA: 0 }
      );
      this.omniApplyCallResp({outmem:ooamem},true);
      const ooaRule = totals.totalOOA / totals.totalEmp > OOA_PERCENT;
      if (ooaRule) this.showOOAErrorMessage = true;
      else this.showOOAErrorMessage = false;
      this.isOOARuleValid = !ooaRule;
      this.isCensusValid = !ooaRule;
      this.omniUpdateDataJson({
        isCensusValid:
          this.employees.length && this?.omniJsonData?.AddEditEmployees.AddEmployeesLWC.isCensusValid
            ? this.isCensusValid
            : false
      });
      C_LOG.push({
        isCensusValid: this.isCensusValid,
        isOOARuleValid: this.isOOARuleValid,
        totals: totals,
        showOOAErrorMessage: this.showOOAErrorMessage
      });
    }
  }

  validateZipcodes() {
    const params = getRemoteParams(this.census, this.region);
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    C_LOG.push("validateZipcodes");
    this?.omniRemoteCall?.(params, false)
      .then((response) => {
        if (response?.result?.OBDRresp?.zipcode) {
          this.zipMap.set(response.result.OBDRresp.zipcode, true);
        } else if (Array.isArray(response?.result?.OBDRresp)) {
          response.result.OBDRresp.forEach((zipWrapper) => {
            this.zipMap.set(zipWrapper.zipcode, true);
          });
        }
      })
      .then(() => {
        this.markInvalidZips();
      });
  }

  saveMembers(initCensus, uploadCensusFlag) {
    if (!uploadCensusFlag) {
      initCensus = {
        initCensusLength: this.census.length,
        initCensusObj: this.census
      };
    }
    const editedMembers = this.census.filter((m) => m.edited); // Filter edited members only
    let callService = true;
    // Display error message on member if required field is missing
    if (this.census) {
      this.census.forEach((editedMember) => {
        if (!this.evaluateFields(editedMember)) {
          callService = false;
          editedMember.error = this.globalEmpError;
        }
        if (editedMember.dependents) {
          editedMember.dependents.forEach((dependentMember) => {
            if (!this.evaluateFields(dependentMember)) {
              callService = false;
              dependentMember.error = this.globalDepError;
            }
          });
        }
      });
      if (!callService) {
        this.omniUpdateDataJson({
          isCensusValid: false
        });
        /*below line is for refreshing census screen back and fix Indefinite loading when uploading
          csv file and return error message on members if birthdate/relationship are blank*/
        this.isLoaded = true;
        return;
      }
    }
    if (callService) {
      this.validateZipcodes();
      // this.omniUpdateDataJson({
      //   isCensusValid: true
      // });
    }
    if (editedMembers.length > 0 && callService === true) {
      this.isLoaded = false;
      let saveAction = JSON.parse(JSON.stringify(this.omniJsonDef.propSetMap.saveAction || {}));
      saveAction.inputMap = { ...saveAction.inputMap, ...this.censusInputMap(editedMembers) };
      this.clearSubsBeforeUpload(initCensus, saveAction, uploadCensusFlag);
    }
    this.empCensusUpdated = true;
    this.omniUpdateDataJson({
      EmpCensusUpdated: this.empCensusUpdated
    });
  }

  clearSubsBeforeUpload(initCensus, saveAction, uploadCensusFlag) {
    console.log([...JSON.parse(JSON.stringify(saveAction.inputMap.census.members))]);
    if (initCensus.initCensusLength > 0 && uploadCensusFlag) {
      let memberIdentifiers = initCensus.initCensusObj.map((member) =>
        dataFormatter.getNamespacedProperty(member, "MemberIdentifier__c")
      );
      let deletionIds = [];
      initCensus.initCensusObj.forEach((member) => {
        // Extract Ids for members
        if (
          memberIdentifiers.some((id) => dataFormatter.getNamespacedProperty(member, "MemberIdentifier__c") === id) &&
          member.Id
        ) {
          deletionIds.push({ Id: member.Id });
        }
      });
      if (deletionIds.length > 0) {
        // Make API call to delete the members
        this.isLoaded = false;
        let deleteAction = JSON.parse(JSON.stringify(this.omniJsonDef.propSetMap.deleteAction || {}));
        deleteAction.inputMap = { ...deleteAction.inputMap, ...this.censusInputMap(deletionIds) };
        this.invokeService(deleteAction, "InsCensusService", "deleteMembers")
          .then(() => {
            this.invokeService(saveAction, "InsCensusService", "updateMembers")
              .then((saveResponse) => {
                // cpq-16111 changes start - remove all references to SgCensusMemberAgeCalculation class
                this.loadCensus().then((loadResponse) => {
                  const newCensusMap = this.generateUpdatedCensusMap(loadResponse);
                  this.handleUpdateCensusLoad(newCensusMap, saveResponse);
                });
              })
              .catch((err) => this.showError({ message: err }));
          })
          .catch((err) => this.showError({ message: err }));
      } else {
        // Delete members from client end since associate record ID is not created yet.
        this.census = this.census.filter(
          (member) => !memberIdentifiers.includes(dataFormatter.getNamespacedProperty(member, "MemberIdentifier__c"))
        );
        this.calculateCensusInfo();
        if (this.currentPageHasNoItems()) {
          this.navigateToLastPage();
        }
      }
    } else {
      this.invokeService(saveAction, "InsCensusService", "updateMembers")
        .then((saveResponse) => {
          this.loadCensus().then((loadResponse) => {
            const newCensusMap = this.generateUpdatedCensusMap(loadResponse);
            this.handleUpdateCensusLoad(newCensusMap, saveResponse);
          });
        })
        .catch((err) => this.showError({ message: err }));
    }
  }
  /**
   * Create an updated census map based on the response of census loading service
   * @param {Object} getMembersResponse Response object from getMembers service
   * @returns {Object}
   */
  generateUpdatedCensusMap(getMembersResponse) {
    this.isLoaded = true;
    const loadResponse = JSON.parse(getMembersResponse);
    const currentCensusMap = this.census.reduce((result, member) => {
      result[dataFormatter.getNamespacedProperty(member, "MemberIdentifier__c")] = member;
      return result;
    }, {});
    const fetchedCensusMap = loadResponse.census.members.reduce((result, member) => {
      result[dataFormatter.getNamespacedProperty(member, "MemberIdentifier__c")] = member;
      return result;
    }, {});
    return { ...currentCensusMap, ...fetchedCensusMap };
  }
  /**
   * Check save operation response for errors and update component census data
   * @param {Object} newCensusMap Updated census object
   * @param {Object} saveMembersResponse Census update service response
   */
  handleUpdateCensusLoad(newCensusMap, saveMembersResponse) {
    const saveResponse = JSON.parse(saveMembersResponse);
    let updatedCensusMap = { ...newCensusMap };
    Object.values(updatedCensusMap).forEach((member) => delete member.error); // Reset errors
    if (saveResponse.addPlanErrors) {
      this.showError({ message: saveResponse.addPlanErrors });
    }
    if (saveResponse.errors) {
      saveResponse.errors.forEach((erroredMember) => {
        const memberIdentifier = dataFormatter.getNamespacedProperty(erroredMember, "MemberIdentifier__c");
        if (memberIdentifier) {
          updatedCensusMap[memberIdentifier].error = erroredMember.error;
        }
      });
    }
    this.census = Object.values(updatedCensusMap).map((member) => {
      member.uuid = dataFormatter.uniqueKey();
      return member;
    });
    this.calculateCensusInfo();

    this.empCensusUpdated = true;
    this.omniUpdateDataJson({
      EmpCensusUpdated: this.empCensusUpdated
    });
  }
  /**
   * Remove deleted members from component census data
   * @param {Object} newCensusMap Updated census object
   * @param {Array} memberIdentifiers Array of deleted member IDs
   */
  handleDeleteCensusLoad(newCensusMap, memberIdentifiers) {
    memberIdentifiers.forEach((memberId) => {
      if (newCensusMap[memberId]) {
        delete newCensusMap[memberId];
      }
    });
    this.census = Object.values(newCensusMap).map((member) => {
      member.uuid = dataFormatter.uniqueKey();
      return member;
    });
    this.calculateCensusInfo();
    if (this.currentPageHasNoItems()) {
      this.navigateToLastPage();
    }
    this.empCensusUpdated = true;
    this.omniUpdateDataJson({
      EmpCensusUpdated: this.empCensusUpdated
    });
  }

  currentPageHasNoItems() {
    let totalNumberOfItems = this.employees.length;
    let totalNumberOfPages = Math.ceil(totalNumberOfItems / this.itemsPerPage);
    totalNumberOfPages = totalNumberOfPages - 1;
    return this.currentPage >= totalNumberOfPages;
  }
  /**
   * Prepares input for census service request.
   * @param {Array} members
   * @returns {Object} Input map for service
   */
  censusInputMap(members) {
    let defaultHeader = [
      { name: `${namespace}PrimaryMemberIdentifier__c` },
      { name: `${namespace}MemberIdentifier__c` },
      { name: `${namespace}IsPrimaryMember__c` },
      { name: `${namespace}IsSpouse__c` },
      { name: `${namespace}RelatedCensusMemberId__c` }
    ];
    return {
      censusId: this.censusId,
      census: {
        headers: defaultHeader.concat(this.headers),
        members
      }
    };
  }
  // Saving state information.
  saveState() {
    this.omniSaveState(
      {
        census: this.census,
        headers: this.headers,
        labels: this.labels
      },
      null,
      true
    );
  }

  evaluateEditedMembers() {
    // Filter out non-edited census members.
    const editedMembers = this.census.filter((m) => m.edited);
    // Create and format output JSON with headers and census members.
    let saveAction = JSON.parse(JSON.stringify(this.omniJsonDef.propSetMap.saveAction || {}));
    if (editedMembers.length > 0) {
      saveAction.inputMap = { ...saveAction.inputMap, ...this.censusInputMap(editedMembers) };
      // Set flag to true to signify that there are members to add or update.
      this.omniApplyCallResp(
        {
          updateMembers: true,
          updateMembersRequest: saveAction
        },
        true
      );
    } else {
      saveAction.inputMap = { ...saveAction.inputMap, ...this.censusInputMap([]) };
      // Set flag to false to signify that there are no members to add or update.
      this.omniApplyCallResp(
        {
          updateMembers: false,
          updateMembersRequest: []
        },
        true
      );
    }
  }
  /**
   * Passes a JSON of all census members
   * when the component is removed from the page.
   */
  disconnectedCallback() {
    this.saveState();
    /**
     * Start of changes for CPQ-7290: pass JSON
     * of census members and header information to
     * the omniscript's data JSON.
     * */
    // Filter out non-edited census members.
    const editedMembers = this.census.filter((m) => m.edited);
    // Create and format output JSON with headers and census members.
    let saveAction = JSON.parse(JSON.stringify(this.omniJsonDef.propSetMap.saveAction || {}));
    if (editedMembers.length > 0) {
      saveAction.inputMap = { ...saveAction.inputMap, ...this.censusInputMap(editedMembers) };
      // Set flag to true to signify that there are members to add or update.
      this.omniApplyCallResp(
        {
          updateMembers: true,
          updateMembersRequest: saveAction
        },
        true
      );
    } else {
      saveAction.inputMap = { ...saveAction.inputMap, ...this.censusInputMap([]) };
      // Set flag to false to signify that there are no members to add or update.
      this.omniApplyCallResp({ updateMembers: false }, true);
    }
    // Send data to omniscript JSON.
    this.omniApplyCallResp(saveAction.inputMap, true);
    this.omniApplyCallResp(
      {
        censusCountInfo: this.censusInfo,
        PostCensusToOpportunity: false
      },
      true
    );
    /**
     * END OF CHANGES FOR CPQ-7290
     */
    pubsub.unregister(this.formChannel, this.pubsubCensusFileUploaded);
  }

  downloadFile() {
    window.open(this.censusTemplateName);
  }

  downloadMembershipEnrollmentTemplate() {
    if (this.region !== 'Mid-Atlantic States')
      window.open(this.censusEnrollmentTemplateName);
    else
      window.open(this.censusKeelTemplateName);
  }

  downloadUploadCensusTemplate() {
    window.open(this.censusTemplateName);
  }
  /** ******* Pagination logic start here */
  generatePages(current, last) {
    const buffer = 2;
    const leftCounter = current - buffer;
    const rightCounter = current + buffer + 1;
    const pages = [];
    let pagesWithEllipses = [];
    let prevPage;

    for (let i = 1; i <= last; i++) {
      if (i === 1 || i === last || (i >= leftCounter && i < rightCounter)) {
        pages.push(i);
      }
    }
    pages.forEach(function (page) {
      if (prevPage) {
        if (page - prevPage === buffer) {
          pagesWithEllipses.push(prevPage + 1);
        } else if (page - prevPage !== 1) {
          pagesWithEllipses.push("...");
        }
      }
      pagesWithEllipses.push(page);
      prevPage = page;
    });
    if (pagesWithEllipses.length === 1) {
      return [];
    }
    return pagesWithEllipses;
  }

  get pageNumbers() {
    const totalNumberOfItems = this.employees.length;
    const totalNumberOfPages = Math.ceil(totalNumberOfItems / this.itemsPerPage);
    const pages = this.generatePages(this.currentPage, totalNumberOfPages);
    return pages.map((p) => {
      const page = {
        index: p,
        className:
          p === this.currentPage + 1
            ? `${this.theme}-button ${this.theme}-button_brand`
            : `${this.theme}-button ${this.theme}-button_neutral`
      };
      return page;
    });
  }

  sortMembersByField(field) {
    console.log(`sorting by ${field}`);
    console.log(this.census);
    this.census.sort((a,b) => {
      if (!a[field])
        a[field] = '';
      if (!b[field])
        b[field] = '';
      a[field].localeCompare(b[field])
    });
  }

  get pageData() {
    let startIndex = this.currentPage * this.itemsPerPage;
    for (let i = 0; i < this.employees.length; i++)
      this.employees[i].isSelected = true;
    for (let i = 0; i < this.employees.length; i++) {
      if (i === this.employees.length - 1)
        this.employees[i].isLast = true;
      else
        this.employees[i].isLast = false;
    }
    console.log('this.census', this.census);
    console.log('this.employees', this.employees);
    return this.employees ? this.employees.slice(startIndex, startIndex + this.itemsPerPage) : [];
  }

  get showPrevPageControl() {
    return this.currentPage > 0;
  }

  get showNextPageControl() {
    let totalNumberOfItems = this.employees.length;
    let totalNumberOfPages = Math.ceil(totalNumberOfItems / this.itemsPerPage);
    return this.currentPage < totalNumberOfPages - 1;
  }

  get showPagination() {
    return this.employees.length > this.itemsPerPage;
  }

  navigateToFirstPage() {
    this.currentPage = 0;
  }

  navigateToPrevPage() {
    this.currentPage--;
  }

  navigateToNextPage() {
    this.currentPage++;
  }

  navigateToLastPage() {
    const totalNumberOfItems = this.employees.length;
    const totalNumberOfPages = Math.ceil(totalNumberOfItems / this.itemsPerPage);
    this.currentPage = totalNumberOfPages - 1;
  }

  navigateToPage(event) {
    const pageIndex = event.currentTarget.dataset.index;
    if (pageIndex !== "...") {
      this.currentPage = pageIndex - 1;
    }
  }
  /** ********** Pagination ends here */
  get showSave() {
    return this.employees.length > 0;
  }

  filemapCreated(ev) {
    this.isLoaded = false;
    const csvData = ev.detail.data || [];
    console.log('filemapCreated', csvData);
    if (csvData.length > this.censusMemberUploadLimit) {
      this.showError({
        message: this.labels.InsOSCensusErrorExceedRowCount.replace("{0}", this.censusMemberUploadLimit)
      });
      this.isLoaded = true;
      return;
    }
    this.csvDataToCensus(csvData);
  }

  get availableEnrollmentPlanOptions() {
    const enrollmentPlanHeader = this.headers.find((header) => header.name === this.planHeaderFieldName);
    return enrollmentPlanHeader ? enrollmentPlanHeader.options : [];
  }

  get isModalButton() {
    return true;
  }

  get isNotModalButton() {
    return false;
  }
  /**
   * Converts the result of XLSX parsing to census JSON
   * @param {Object} csvData
   */
  csvDataToCensus(csvData) {
    const availableEnrollmentPlanOptions = this.availableEnrollmentPlanOptions;
    let empUniqueId = null;
    let currentDepBatch = [];
    let members = csvData.map((csvRow) => {
      /*below logic will convert relationship value to uppercase and assign valid values to picklist
        while uploading csv file*/
      if (csvRow.Relationship__c != "") {
        let convertToUppercase = csvRow.Relationship__c;
        let relationValue = convertToUppercase.toUpperCase();
        if (relationValue == "EMPLOYEE") {
          csvRow.Relationship__c = "Employee";
        } else if (relationValue == "SPOUSE") {
          csvRow.Relationship__c = "Spouse";
        } else if (relationValue == "CHILD") {
          csvRow.Relationship__c = "Child";
        } else if (relationValue == "DOMESTIC PARTNER") {
          csvRow.Relationship__c = "Domestic Partner";
        } else if (relationValue == "OVER-AGE DISABLED DEPENDENT") {
          csvRow.Relationship__c = "Over-age Disabled Dependent";
        } else if (relationValue == "NOT COVERED") {
          csvRow.Relationship__c = "Not Covered";
        }
      }
      let member = this.addNewMember(false);
      Object.keys(csvRow).forEach((key) => {
        member[key] = csvRow[key];
      });
      /*added below logic for saving Relationship__c values backend when csv uploaded. 11291 start*/
      if (member.Relationship__c != "") {
        if (member.Relationship__c == "Employee") {
          empUniqueId = dataFormatter.getNamespacedProperty(member, "MemberIdentifier__c");
        } else if (member.Relationship__c == "Spouse" || member.Relationship__c == "Domestic Partner") {
          member[`${namespace}IsPrimaryMember__c`] = false;
          member[`${namespace}IsSpouse__c`] = true;
          member[`${namespace}PrimaryMemberIdentifier__c`] = empUniqueId || "";
        } else {
          member[`${namespace}IsPrimaryMember__c`] = false;
          member[`${namespace}IsSpouse__c`] = false;
          member[`${namespace}PrimaryMemberIdentifier__c`] = empUniqueId || "";
        }
        if (empUniqueId === null) {
          currentDepBatch.push(member);
        } else {
          currentDepBatch.forEach((m) => {
            m[`${namespace}PrimaryMemberIdentifier__c`] = empUniqueId;
          });
          currentDepBatch.length = 0;
        }
      }
      // 11291 end
      /*commented below OOB Relationship field logic for displaying custom Relationship__c field
            when census is loaded.Do not delete below commented logic*/
      /* if (member[RELATIONSHIP_HEADER]) {
                 if (member[RELATIONSHIP_HEADER] === 'Employee') {
                     empUniqueId = dataFormatter.getNamespacedProperty(member, 'MemberIdentifier__c');
                 } else if (member[RELATIONSHIP_HEADER] === 'Spouse'
                 || member[RELATIONSHIP_HEADER] === 'Domestic Partner') {
                     member[`${namespace}IsPrimaryMember__c`] = false;
                     member[`${namespace}IsSpouse__c`] = true;
                     member[`${namespace}PrimaryMemberIdentifier__c`] = empUniqueId || '';
                 } else {
                     member[`${namespace}IsPrimaryMember__c`] = false;
                     member[`${namespace}IsSpouse__c`] = false;
                     member[`${namespace}PrimaryMemberIdentifier__c`] = empUniqueId || '';
                 }
                 if (empUniqueId === null) {
                     currentDepBatch.push(member);
                 } else {
                     currentDepBatch.forEach(m => {
                         m[`${namespace}PrimaryMemberIdentifier__c`] = empUniqueId;
                     });
                     currentDepBatch.length = 0;
                 }
             }*/
      if (member[this.planHeaderFieldName]) {
        this.addPlansToMember(member, availableEnrollmentPlanOptions);
      }
      return member;
    });
    let initCensus = {
      initCensusLength: this.census.length,
      initCensusObj: this.census
    };
    this.formatAllDateFields(members);
    this.census = members;
    this.calculateCensusInfo();
    this.navigateToFirstPage();
    this.saveMembers(initCensus, true);
    if (this.isFromNewCustomerSetup)
      this.ncsCensusStarted = true;
  }

  addPlansToMember(member, availableEnrollmentPlanOptions) {
    member[this.planHeaderFieldName] = member[this.planHeaderFieldName]
      .reduce((ids, plan) => {
        const selectedPlan = availableEnrollmentPlanOptions.find(
          (option) => option.type === plan.header && option.name === plan.value
        );
        if (selectedPlan) {
          ids.push(selectedPlan.value);
        }
        return ids;
      }, [])
      .join(";");
  }

  formatAllDateFields(members) {
    const dateFields = this.headers.filter((header) => {
      return header.type === "DATE" || header.type === "DATETIME";
    });
    if (dateFields.length === 0) {
      return;
    }
    members.forEach((member) => {
      dateFields.forEach((dateField) => {
        if (member[dateField.name]) {
          //if birthdate not null then below logic add 8 hours to fix one day decrement Issue.
          if (member[dateField.name] != null) {
            let dt = new Date(member[dateField.name]);
            dt.setHours(dt.getHours() + 10);
            member[dateField.name] = dt;
            member[dateField.name] = dayjs(new Date(member[dateField.name])).format("YYYY-MM-DD");
          }
        }
      });
    });
  }

  employeeAccordianHandler(event) {
    let option = event.target.dataset.accordian;
    if (option === "expand") {
      this.employees.forEach((employee) => {
        employee.isSelected = true;
      });
    } else if (option === "collapse") {
      this.employees.forEach((employee) => {
        employee.isSelected = false;
      });
    }
  }

  handleUploadError(error) {
    this.uploadErrorMessage = error.detail.error;
    this.openUploadCensusErrorModal();
  }

  invokeService(options, remoteClass, remoteMethod) {
    let memberReq = omniscriptUtils.formatQuery(this.omniGetMergeField.bind(this), options, remoteClass, remoteMethod);
    return omniscriptUtils.omniGenericInvoke(this, memberReq);
  }
  // Overwrites method from OmniscriptBaseMixin to prevent user from using Next button
  @api
  checkValidity() {
    return true;
  }

  showDeleteAllModal() {
    this.template.querySelector(".vloc-ins-delete-all-modal").openModal();
  }

  closeDeleteAllModal() {
    this.template.querySelector(".vloc-ins-delete-all-modal").closeModal();
  }

  showUploadCensusModal() {
    this.template.querySelector(".upload-census-modal").openModal();
  }

  showUploadKeelCensusModal() {
    this.template.querySelector(".upload-keel-census-modal").openModal();
  }

  closeUploadCensusModal() {
    this.template.querySelector(".upload-census-modal").closeModal();
  }

  closeUploadKeelCensusModal() {
    this.template.querySelector(".upload-keel-census-modal").closeModal();
  }

  openUploadCensusErrorModal() {
    this.template.querySelector(".upload-census-error-modal").openModal();
  }

  closeUploadCensusErrorModal() {
    this.template.querySelector(".upload-census-error-modal").closeModal();
  }

  handleDocumentDownload() {
    const metadata = {
      fetchedObject: null,
      protocolDomain: "",
      pathQueries: "",
      url: ""
    };
    if (this.congaUrls.length && this?.omniJsonData?.sObjects?.censusId) {
      metadata.fetchedObject = this.congaUrls.find((url) => url.SearchKey === "AddSubDownloadCensusDetails");
      metadata.protocolDomain = metadata.fetchedObject?.ProtocolDomain;
      metadata.pathQueries = metadata.fetchedObject?.PathQueries.replaceAll(
        "=$$",
        `=${this.omniJsonData.sObjects.censusId}`
      );
      metadata.url = `${metadata.protocolDomain}${metadata.pathQueries}`;
      CongaModal.open({
        size: "small",
        header: "Generating Document",
        content: "Content",
        congaUrl: metadata.url
      });
    } else
      console.log({ urls: this.congaUrls, censusId: this?.omniJsonData?.sObjects?.censusId });
  }

  get isEnrollmentSpreadsheet() {
    return true;
  }

  get isMasRegion () {
    return this.region === 'Mid-Atlantic States';
  }
}