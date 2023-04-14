import { LightningElement, api } from 'lwc';
import { namespace } from 'vlocity_ins/utility';
import { commonUtils, dataFormatter } from 'vlocity_ins/insUtility';
import pubsub from 'vlocity_ins/pubsub';

const HIDDEN_FIELDS = ['IsSpouse__c', 'OptOutTypes__c', 'ContractLineId__c'];

export default class SgBrokerAddSubscribersInfo extends LightningElement {
    @api member;
    @api headers;
    @api index;
    @api theme = 'slds';
    @api disableRelationshipField;
    @api typeToEnrolledPlans;
    @api fromNcs;
    @api effectiveDate;
    @api errMsgDep;
    person;
    labels = {
        Delete: 'Delete',
        InsOSCensusRelationship: 'Relationship',
        InsOSCensusRelationshipEmployee: 'Employee',
        InsOSCensusRelationshipSpouse: 'Spouse',
        InsOSCensusRelationshipChild: 'Child',
    };
    hiddenFieldsWithPrefix = [];
    types = [];
    optOutTypesField;
    formChannel = `kpsgEmployeeCensusInfo-${dataFormatter.uniqueKey()}`;
    validOptOutTypes = ['Medical', 'Dental', 'Vision'];
    pubsubPayload = {
        changeFieldValue: this.handleChange.bind(this)
    };
    pubsubPayloadBirthdateAge = {
        changeBirthdayOrAge: this.handleChangeBirthdateOrAge.bind(this)
    };
    isDependentMember;
    physicalAssertion;
    birthdateHasValue = null;
    ageHasValue = null;

    connectedCallback () {
        this.index = this.index + 1;
        this.hiddenFieldsWithPrefix = HIDDEN_FIELDS.map(f => `${namespace}${f}`);
        this.person = { ...this.member };
        if (this.person.dependents)
            delete this.person.dependents;
        this.optOutTypesField = this.headers.find(el => el.name === `${namespace}OptOutTypes__c`);
        pubsub.register(this.formChannel, this.pubsubPayload);
        this.isDependentMember = !dataFormatter.getNamespacedProperty(this.person, 'IsPrimaryMember__c');
        pubsub.register(this.formChannel, this.pubsubPayloadBirthdateAge);
    }

    disconnectedCallback () {
        pubsub.unregister(this.formChannel, this.pubsubPayload);
        pubsub.unregister(this.formChannel, this.pubsubPayloadBirthdateAge);
    }

    /**
     * Onchange event from insField
     * @param {Object} payload
     */
    handleChange(payload) {
        this.person[payload.fieldName] = payload.value;
        commonUtils.triggerCustomEvent.call(this, 'update', { detail: this.person });
    }

    handleChangeBirthdateOrAge (payload) {
        if (!this.isNullishValue(payload.value))
            this.setBirthdateAndAgeValues(payload, true);
        else
            this.setBirthdateAndAgeValues(payload, false);
        if (!this.birthdateHasValue)
            return;
        this.clearAge = false;
    }

    isNullishValue (payload) {
        return !(payload !== null && payload !== '' && payload !== undefined && payload !== 0);
    }

    setBirthdateAndAgeValues (payload, hasValues) {
        switch (payload.fieldName.toLowerCase()) {
            case 'vlocity_ins__birthdate__c':
                hasValues ? this.birthdateHasValue = true : this.birthdateHasValue = false;
                if (!this.birthdateHasValue) {
                    this.handleChange({ fieldName: 'Age__c', value: null, isInvalid: false });
                    this.clearAge = true;
                }
                break;
            case 'age__c':
                hasValues ? this.ageHasValue = true : this.ageHasValue = false;
                break;
            default:
                break;
        }
    }

    deleteMember() {
        commonUtils.triggerCustomEvent.call(this, 'delete', { detail: this.person });
    }

    evaluateSavedAgeAndBirthdate (member) {
        if (
            (member.vlocity_ins__Birthdate__c === null || member.vlocity_ins__Birthdate__c === '') &&
            (member.Age__c !== null && member.Age__c !== '' && member.Age__c !== undefined)
        ) 
            this.onlyAgePresent = true;
        else 
            this.onlyAgePresent = false;
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
    // Age evaluation - END

    setDepErrorMsgIfEmpty () {
        const ageEval = this.evaluateMemberAge(this.handleMemberAge(this.member.vlocity_ins__Birthdate__c, this.effectiveDate), this.member.Relationship__c);
        if (!this.errMsgDep && !this.member?.vlocity_ins__Birthdate__c && !this.member?.Age__c && !this.member.Relationship__c)
            this.errMsgDep = 'Required fields are missing.';
        else if (!!this.member.vlocity_ins__Birthdate__c && ageEval.depOver26 || this.member.Age__c !== '' && +this.member.Age__c >= 26)
            this.errMsgDep = 'Non-disabled dependents over the age of 25 at the effective date cannot be enrolled.';
    }

    get isDependent() {
        this.setDepErrorMsgIfEmpty();
        return !dataFormatter.getNamespacedProperty(this.person, 'IsPrimaryMember__c');
    }

    get headerColumns() {
        let invalidZip = this.member?.invalidZip;
        if (invalidZip !== undefined) this.physicalAssertion = invalidZip;
        let headersParsed = JSON.parse(JSON.stringify(this.headers));
        let columns = headersParsed.filter(header => !this.hiddenFieldsWithPrefix.includes(header.name));
        let columnsForMapping = [];
        this.evaluateSavedAgeAndBirthdate(this.member);
        if (!!this.isDependentMember) {
            for (let i = 0; i < columns.length; i++) {
                if (
                    columns[i]?.name === 'vlocity_ins__FirstName__c' ||
                    columns[i]?.name === 'Middle_Initial__c' ||
                    columns[i]?.name === 'vlocity_ins__LastName__c' ||
                    columns[i]?.name === 'Zip_Code__c' ||
                    columns[i]?.name === 'Physical_Assertion__c'
                ) {
                    columns.splice(i,1);
                }
            }
        }
        const isPrimaryMember = dataFormatter.getNamespacedProperty(this.person, 'IsPrimaryMember__c');
        var employeeOptions = [];
        employeeOptions.push({ value: 'Employee', label: 'Employee' });
        var dependentOptions = [];
        dependentOptions.push({ value: 'Spouse', label: 'Spouse' });
        dependentOptions.push({ value: 'Domestic Partner', label: 'Domestic Partner' });
        dependentOptions.push({ value: 'Child', label: 'Child' });
        dependentOptions.push({ value: 'Over-age Disabled Dependent', label: 'Over-age Disabled Dependent'});
        dependentOptions.push({ value: 'Not Covered', label: 'Not Covered'});
        // Removing Middle Initial from Dependent
        if (!!this.isDependentMember) {
            columnsForMapping = columns.filter(column => (column?.name !== 'Middle_Initial__c' && column?.name !== 'Physical_Assertion__c' && column?.name !=='Is_In_Area__c'));
            columnsForMapping.sort((a,b) => a?.type.localeCompare(b?.type));
        } else {
            columnsForMapping = [...columns];
        }
        let columnsReturn = columnsForMapping.map(column => {
            return {
                isDependentMember: this.isDependentMember,
                dataType: column.type === 'REFERENCE' || column.type === 'DATE' ? 'LOOKUP' : column.type,
                isUpdateable: true,
                options: column.name === 'Relationship__c' ? isPrimaryMember ? employeeOptions : dependentOptions : column.options,
                label: column.label,
                value: column.name === `${namespace}IsSpouse__c` && isPrimaryMember ? this.labels.InsOSCensusRelationshipEmployee : this.member[column.name],
                fieldName: column.name,
                objectApiName: `${namespace}GroupCensusMember__c`,
                isZipCode: column.name === 'Zip_Code__c' ? true : false,
                invalidZip: this.physicalAssertion,
                birthdateHasValue: this.birthdateHasValue,
                ageHasValue: this.ageHasValue,
                fromNcsMember: this.fromNcs,
                clearAge: this.clearAge,
                onlyAgePresent: this.onlyAgePresent
            };
        });
        return columnsReturn;
    }

    handleMultiValueUpdate(event) {
        const dataset = event.target && event.target.dataset;
        if (!dataset) return;
        const fieldName = dataset.fieldName;
        let currentValue = this.person[fieldName] ? this.person[fieldName].split(';') : [];
        const fieldValue = dataset.fieldValue;
        if (currentValue.includes(fieldValue)) currentValue = currentValue.filter(value => value !== fieldValue);
        else currentValue.push(fieldValue);
        this.person[fieldName] = currentValue.join(';');
        commonUtils.triggerCustomEvent.call(this, 'update', { detail: this.person });
    }

    get hasOptOut() {
        return this.optOutTypesField != null && this.isDependent;
    }

    get enrolledPlanTypes() {
        return Object.keys(this.typeToEnrolledPlans || {}).filter(
            type => this.typeToEnrolledPlans[type] && this.typeToEnrolledPlans[type].length > 0
        );
    }

    get optOutTypes() {
        const optOutTypes = dataFormatter.getNamespacedProperty(this.person, 'OptOutTypes__c');
        let selectedValues = optOutTypes ? optOutTypes.split(';') : [];
        let values = this.optOutTypesField.options.reduce((optOutTypeFields, { label, value }) => {
            if (this.validOptOutTypes.includes(value) && this.enrolledPlanTypes.includes(value))
                optOutTypeFields.push({ label, value, checked: !selectedValues.includes(value) });
            return optOutTypeFields;
        }, []);
        return values;
    }
}