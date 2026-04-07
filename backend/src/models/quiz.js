module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Quiz',
    {
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      mode: {
        type: DataTypes.ENUM('classic', 'buzz'),
        allowNull: false,
        defaultValue: 'classic',
      },
      accentColor: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '#ff6b6b',
      },
      isPublished: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      editorPinHash: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      storageKey: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      tableName: 'quizzes',
    },
  );
