import { LightningElement, api, track } from 'lwc';
import { namespace } from 'vlocity_ins/utility';
import { commonUtils, dataFormatter } from 'vlocity_ins/insUtility';

export default class SgBrokerAddSubscribersRow extends LightningElement {
    @api member;
    @api headers;
    @api theme = 'slds';
    @api displaySettings;
    @api islast;
    @api fromNcs;
    @api effectiveDate;
    @api errMsgDep;
    @track errMsgEmp;

    //labels = LABELS;
    labels = {
        InsOSCensusRelationshipEmployee :'Employee',
        InsMissingInformation :'Missing Information',
        Delete : 'Delete',
        InsDemographic : 'Demographic',
        InsDependentPlural : 'Dependents',
        InsDependent : 'Dependent',
        InsOSCensusAddDependent : '+ Add dependent',
        InsQuotesDetails : 'Details',
        InsPlans : 'Plans',
        InsSpouseOrPartnerCount : 'Spouse/Domestic Partner',
        InsChildCount : 'Children',
    };
    sections = [];
    planSections = [];
    typeToEnrolledPlans = {};
    planFieldName = `${namespace}ContractLineId__c`;

    connectedCallback() {
        this.initializeSections();
        this.initializePlanSections();
    }
    
    initializeSections() {
        if (this.displaySettings && this.displaySettings.categories) {
            const categories = this.displaySettings.categories;
            const categorizedFields = [];
            this.sections = categories.map((category, index) => {
                const categoryFields = category.fields || [];
                categorizedFields.push(...categoryFields);
                return {
                    key: `accordion_${index}`,
                    title: category.name,
                    headers: category.fields.reduce((categoryHeaders, fieldName) => {
                        const header = this.headers.find(h => h.name === fieldName);
                        if (header != null) {
                            categoryHeaders.push(header);
                        }
                        return categoryHeaders;
                    }, []),
                    disableRelationshipField: index > 0
                };
            });
            this.sections.push({
                key: 'accordion_details',
                title: this.labels.InsQuotesDetails,
                headers: this.headers.filter(header => !categorizedFields.includes(header.name)),
                disableRelationshipField: true
            });
        } else {
            this.sections = [
                {
                    key: 'accordion_details',
                    title: this.labels.InsQuotesDetails,
                    headers: this.headers
                }
            ];
        }
    }

    initializePlanSections() {
        const typeToEnrolledPlans = {};
        const enrollmentPlanHeader = this.headers.find(header => header.name === this.planFieldName);
        const memberPlans = this.member[this.planFieldName] ? this.member[this.planFieldName].split(';') : [];
        if (enrollmentPlanHeader) {
            enrollmentPlanHeader.options.forEach(opt => {
                if (!typeToEnrolledPlans[opt.type]) {
                    typeToEnrolledPlans[opt.type] = [];
                }
                if (memberPlans.includes(opt.value)) {
                    typeToEnrolledPlans[opt.type].push(opt.name);
                }
            });
            this.typeToEnrolledPlans = typeToEnrolledPlans;
        }
        this.planSections = Object.keys(typeToEnrolledPlans).map((type, index) => {
            const plan = {
                fieldName: this.planFieldName,
                dataType: 'text',
                label: type,
                isUpdateable: false
            };

            const values =
                typeToEnrolledPlans[type].length > 0
                    ? typeToEnrolledPlans[type].map((p, planIndex) => {
                          return {
                              ...plan,
                              key: `plan_${planIndex}`,
                              value: p
                          };
                      })
                    : [{ ...plan, key: `plan_default` }];

            return {
                label: type,
                key: `plansection_${index}`,
                values
            };
        });
    }

    expand() {
        commonUtils.triggerCustomEvent.call(this, 'selected', { detail: this.member });
    }

    get hasDependents() {
        return this.member.dependents.length > 0;
    }

    addNewDependent() {
        commonUtils.triggerCustomEvent.call(this, 'new', { detail: this.member });
    }

    handleUpdate(ev) {
        commonUtils.triggerCustomEvent.call(this, 'update', ev);
    }

    deleteEmployee() {
        if (this.member.dependents.length < 1) {
            commonUtils.triggerCustomEvent.call(this, 'delete', { detail: this.member });
        } else {
            this.deleteEmployeeCreateWarning();
        }
        return;
    }

    deleteEmployeeCreateWarning () {
        let root = document.body;
        let curtain = document.createElement('div');
        let container = document.createElement('div');
        let header = document.createElement('header');
        let headerClose = document.createElement('button');
        let headerText = document.createElement('h2');
        let body = document.createElement('div');
        let footer = document.createElement('footer');
        let footerNo = document.createElement('button');
        let footerYes = document.createElement('button');
        // Curtain
        curtain.style.width = '100%';
        curtain.style.height = '100%';
        curtain.style.position = 'fixed';
        curtain.style.display = 'flex';
        curtain.style.flexDirection = 'column';
        curtain.style.justifyContent = 'center';
        curtain.style.left = '0';
        curtain.style.top = '0';
        curtain.style.background = 'rgba(126, 140, 153, 0.8)';
        curtain.style.zIndex = '5000000';
        // Container
        container.style.padding = '3rem 0 5rem 0';
        container.style.margin = '0 auto';
        container.style.position = 'relative';
        container.style.height = 'auto';
        container.style.maxWidth = '42rem';
        // Header
        header.style.backgroundImage = 'linear-gradient(45deg, rgba(0, 0, 0, 0.025) 25%, transparent 25%, transparent 50%, rgba(0, 0, 0, 0.025) 50%, rgba(0, 0, 0, 0.025) 75%, transparent 75%, transparent)';
        header.style.backgroundSize = '64px';
        header.style.backgroundColor = '#706E6B';
        header.style.position = 'relative';
        header.style.borderTopLeftRadius = '0.25rem';
        header.style.borderTopRightRadius = '0.25rem';
        headerClose.innerText = 'X';
        headerClose.addEventListener('click', this.destroyEmployeeDeleteCurtain.bind(this, {element: headerClose, delete: false}), false);
        headerClose.style.position = 'absolute';
        headerClose.style.top = '-2.5rem';
        headerClose.style.right = '-0.5rem';
        headerClose.style.width = '2rem';
        headerClose.style.height = '2rem';
        headerClose.style.color = '#fff';
        headerClose.style.cursor = 'pointer';
        headerClose.style.background = 'none';
        headerClose.style.border = 'none';
        headerClose.style.fontSize = '1.75rem';
        headerText.innerText = 'Delete Employee';
        headerText.style.fontSize = '1.25rem';
        headerText.style.lineHeight = '1.25rem';
        headerText.style.textAlign = 'center';
        headerText.style.color = '#fff';
        headerText.style.padding = '1rem';
        headerText.style.margin = '0';
        headerText.style.borderBottomWidth = '2px';
        headerText.style.borderBottomColor = 'rgb(201, 201, 201)';
        headerText.style.borderBottomStyle = 'solid';
        // Body
        body.innerText = 'Warning - Deleting this employee will also delete their dependents. Are you sure you want to proceed?';
        body.style.color = '#0D1C3D';
        body.style.padding = '2.5rem';
        body.style.backgroundColor = '#fff';
        // Footer
        footer.style.backgroundColor = 'rgb(243, 243, 243)';
        footer.style.padding = '12px 16px';
        footer.style.borderTopColor = 'rgb(201, 201, 201)';
        footer.style.borderTopWidth = '2px';
        footer.style.borderTopStyle = 'solid';
        footer.style.borderBottomRightRadius = '0.25rem';
        footer.style.borderBottomLeftRadius = '0.25rem';
        footer.style.textAlign = 'right';
        footerNo.innerText = 'No';
        footerNo.addEventListener('click', this.destroyEmployeeDeleteCurtain.bind(this, {element: footerNo, delete: false}), false);
        footerNo.style.border = '2px solid #006Ba6';
        footerNo.style.borderRadius = '0.25rem';
        footerNo.style.background = '#fff';
        footerNo.style.color = '#006Ba6';
        footerNo.style.padding = '0.75rem 1rem';
        footerNo.style.cursor = 'pointer';
        footerYes.innerText = 'Yes';
        footerYes.addEventListener('click', this.destroyEmployeeDeleteCurtain.bind(this, {element: footerYes, delete: true}), false);
        footerYes.style.border = '2px solid #006Ba6';
        footerYes.style.borderRadius = '0.25rem';
        footerYes.style.background = '#fff';
        footerYes.style.color = '#006Ba6';
        footerYes.style.padding = '0.75rem 1rem';
        footerYes.style.marginLeft = '1rem';
        footerYes.style.cursor = 'pointer';
        // Write to DOM
        header.appendChild(headerClose);
        header.appendChild(headerText);
        footer.appendChild(footerNo);
        footer.appendChild(footerYes);
        container.appendChild(header);
        container.appendChild(body);
        container.appendChild(footer);
        curtain.appendChild(container);
        root.appendChild(curtain);
        return;
    }

    destroyEmployeeDeleteCurtain (payload) {
        if (payload.delete) commonUtils.triggerCustomEvent.call(this, 'delete', { detail: this.member });
        payload.element.parentElement.parentElement.parentElement.remove();
        return;
    }

    deleteDependent(ev) {
        commonUtils.triggerCustomEvent.call(this, 'delete', ev);
    }

    get dependentCount() {
        const dependentLabel =
            this.member.dependents.length === 1 ? this.labels.InsDependent : this.labels.InsDependentPlural;
        return this.member.dependents.length + ' ' + dependentLabel.toLowerCase();
    }

    get getCss() {
        // const classes = `${this.theme}-p-horizontal_medium ${this.theme}-p-vertical_x-small`;
        const classes = `${this.theme}-p-horizontal_medium ${this.theme}-p-vertical_x-small vloc-ins-employee-active ${this.theme}-border_bottom`;
        return this.member.isSelected ? classes + ` vloc-ins-employee-active ${this.theme}-border_bottom` : classes;
    }

    get hasError() {
        return this.member.error || (this.member.dependents && this.member.dependents.some(dep => dep.error));
    }

    get memberIndex() {
        this.setMemberErrorMsgIfEmpty();
        return this.member.index + 1;
    }

    get memberIndexAria() {
        return 'Employee ' + (this.member.index + 1) + ' Details';
    }

    get memberName() {
        return `${dataFormatter.getNamespacedProperty(
            this.member,
            'FirstName__c'
        )} ${dataFormatter.getNamespacedProperty(this.member, 'LastName__c')}`;
    }

    get defaultActiveSectionName() {
        return this.sections[0].key;
    }

    get hasPlans() {
        return this.planSections.length > 0;
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

    setMemberErrorMsgIfEmpty () {
        const ageEval = this.evaluateMemberAge(this.handleMemberAge(this.member.vlocity_ins__Birthdate__c, this.effectiveDate), this.member.Relationship__c);
        if (!!this.member.vlocity_ins__Birthdate__c && ageEval.empUnder18 || this.member.Age__c !== '' && +this.member.Age__c < 18)
            this.errMsgEmp = 'The employee may not meet the minimum age requirement. If the birth date is correct, additional documentation will be required for enrollment.';
        else
            this.errMsgEmp = '';
        if (this.member?.error)
            this.errMsgEmp = this.member.error;
    }
}